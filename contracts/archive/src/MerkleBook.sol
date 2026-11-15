// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {VerdictVault} from "./VerdictVault.sol";

/// @title MerkleBook
/// @notice Pays thousands of payees from one VerdictVault pot without a fixed payee list. The pot's
///         only payee is this book and its refundTo is the funder; this book holds a Merkle root over
///         (index, account, amount) entries.
///
///         - Until `lockTime` (which must be before the pot's deadline, and only while the pot is
///           open) the funder or the operator may set or replace the root. Every change emits
///           `RootSet` with an increasing version. After that the root is final.
///         - Positive outcome: the vault pays the whole pot to the book in one transaction. Anyone
///           may then submit a claim for an account with a proof; the money always goes to that
///           account. A bitmap prevents double claims. Claims can never exceed the root's declared
///           total nor the pot.
///         - After `claimDeadline` (set after the pot's last possible resolution) unclaimed funds go
///           back to the funder with `sweep`.
///         - Negative outcome or expiry: the vault refunds the funder directly; the book does nothing.
///         - A failed transfer (USDC blocklist) never blocks other claims: it becomes claimable.
///
///         Leaves are OpenZeppelin "standard" double-hashed leaves:
///         keccak256(bytes.concat(keccak256(abi.encode(index, account, amount)))).
contract MerkleBook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Drop {
        uint256 potId;
        address funder;
        uint64 lockTime;
        uint64 claimDeadline;
        bytes32 root;
        uint256 rootTotal;
        uint256 claimed;
        uint32 version;
        bool swept;
    }

    VerdictVault public immutable vault;
    IERC20 public immutable usdc;
    address public immutable operator;

    uint256 public dropCount;
    mapping(uint256 dropId => Drop) internal _drops;
    mapping(uint256 dropId => mapping(uint256 word => uint256 bits)) internal _claimedBits;
    mapping(uint256 potId => uint256 dropId) public dropOfPot;
    mapping(address account => uint256) public claimable;
    uint256 public totalClaimable;

    event DropOpened(uint256 indexed dropId, uint256 indexed potId, address indexed funder, uint64 lockTime, uint64 claimDeadline);
    event RootSet(uint256 indexed dropId, bytes32 root, uint256 rootTotal, uint32 version);
    event Claimed(uint256 indexed dropId, uint256 indexed index, address indexed account, uint256 amount);
    event ClaimDeferred(uint256 indexed dropId, uint256 indexed index, address indexed account, uint256 amount);
    event Swept(uint256 indexed dropId, address indexed funder, uint256 amount);
    event DeferredWithdrawn(address indexed account, uint256 amount);

    error NotAuthorized();
    error InvalidPot();
    error AlreadyOpened();
    error InvalidTimes();
    error UnknownDrop();
    error RootLocked();
    error OverAllocated();
    error NotTriggered();
    error ClaimWindowClosed();
    error ClaimWindowOpen();
    error AlreadyClaimed();
    error InvalidProof();
    error AlreadySwept();
    error NothingToClaim();

    constructor(VerdictVault vault_, address operator_) {
        if (address(vault_) == address(0) || operator_ == address(0)) revert InvalidPot();
        vault = vault_;
        usdc = vault_.usdc();
        operator = operator_;
    }

    // ------------------------------------------------------------------ setup

    /// @notice Attaches a drop to an open pot whose only payee is this book. Funder or operator.
    function open(uint256 potId, uint64 lockTime, uint64 claimDeadline, bytes32 root, uint256 rootTotal)
        external
        returns (uint256 dropId)
    {
        VerdictVault.Pot memory p = vault.getPot(potId);
        if (p.status != VerdictVault.Status.Open) revert InvalidPot();
        if (p.payees.length != 1 || p.payees[0] != address(this) || p.sharesBps[0] != 10_000) revert InvalidPot();
        if (msg.sender != p.refundTo && msg.sender != operator) revert NotAuthorized();
        if (dropOfPot[potId] != 0) revert AlreadyOpened();
        // Root changes stop before the pot can no longer be funded; claims start after any resolution.
        if (lockTime <= block.timestamp || lockTime >= p.deadline) revert InvalidTimes();
        if (claimDeadline <= uint256(p.deadline) + vault.gracePeriod()) revert InvalidTimes();

        dropId = ++dropCount;
        Drop storage d = _drops[dropId];
        d.potId = potId;
        d.funder = p.refundTo;
        d.lockTime = lockTime;
        d.claimDeadline = claimDeadline;
        dropOfPot[potId] = dropId;
        emit DropOpened(dropId, potId, p.refundTo, lockTime, claimDeadline);
        if (root != bytes32(0)) _setRoot(dropId, d, p, root, rootTotal);
    }

    /// @notice Sets or replaces the root until lockTime, while the pot is open. Funder or operator.
    function setRoot(uint256 dropId, bytes32 root, uint256 rootTotal) external {
        Drop storage d = _drop(dropId);
        if (msg.sender != d.funder && msg.sender != operator) revert NotAuthorized();
        _setRoot(dropId, d, vault.getPot(d.potId), root, rootTotal);
    }

    function _setRoot(uint256 dropId, Drop storage d, VerdictVault.Pot memory p, bytes32 root, uint256 rootTotal) internal {
        if (block.timestamp >= d.lockTime || p.status != VerdictVault.Status.Open) revert RootLocked();
        if (rootTotal > p.total) revert OverAllocated();
        d.root = root;
        d.rootTotal = rootTotal;
        d.version += 1;
        emit RootSet(dropId, root, rootTotal, d.version);
    }

    // ------------------------------------------------------------------ claims

    /// @notice Pays `amount` to `account` if (index, account, amount) is in the root. Anyone may call.
    function claim(uint256 dropId, uint256 index, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        Drop storage d = _drop(dropId);
        _requireTriggered(d);
        if (block.timestamp > d.claimDeadline) revert ClaimWindowClosed();
        if (isClaimed(dropId, index)) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        if (!MerkleProof.verifyCalldata(proof, d.root, leaf)) revert InvalidProof();
        uint256 claimed = d.claimed + amount;
        // Never more than the root declared nor than the pot (a bad tree cannot drain the book).
        if (claimed > d.rootTotal || claimed > vault.getPot(d.potId).total) revert OverAllocated();

        _claimedBits[dropId][index >> 8] |= 1 << (index & 0xff);
        d.claimed = claimed;
        _pullFromVault();
        if (usdc.trySafeTransfer(account, amount)) {
            emit Claimed(dropId, index, account, amount);
        } else {
            claimable[account] += amount;
            totalClaimable += amount;
            emit ClaimDeferred(dropId, index, account, amount);
        }
    }

    /// @notice After the claim window, returns everything not claimed to the funder. Anyone may call.
    function sweep(uint256 dropId) external nonReentrant {
        Drop storage d = _drop(dropId);
        _requireTriggered(d);
        if (block.timestamp <= d.claimDeadline) revert ClaimWindowOpen();
        if (d.swept) revert AlreadySwept();
        d.swept = true;
        uint256 amount = vault.getPot(d.potId).total - d.claimed;
        _pullFromVault();
        if (amount == 0) return;
        if (usdc.trySafeTransfer(d.funder, amount)) {
            emit Swept(dropId, d.funder, amount);
        } else {
            claimable[d.funder] += amount;
            totalClaimable += amount;
            emit ClaimDeferred(dropId, type(uint256).max, d.funder, amount);
        }
    }

    /// @notice Withdraws amounts whose direct transfer failed. Paid to the caller only.
    function withdrawDeferred() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        emit DeferredWithdrawn(msg.sender, amount);
        usdc.safeTransfer(msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    function getDrop(uint256 dropId) external view returns (Drop memory) {
        return _drops[dropId];
    }

    function isClaimed(uint256 dropId, uint256 index) public view returns (bool) {
        return _claimedBits[dropId][index >> 8] & (1 << (index & 0xff)) != 0;
    }

    // ------------------------------------------------------------------ internal

    function _drop(uint256 dropId) internal view returns (Drop storage d) {
        d = _drops[dropId];
        if (d.potId == 0) revert UnknownDrop();
    }

    function _requireTriggered(Drop storage d) internal view {
        VerdictVault.Pot memory p = vault.getPot(d.potId);
        if (p.status != VerdictVault.Status.Resolved || !p.outcome) revert NotTriggered();
    }

    /// @dev If the vault could not transfer to the book, the pot sits in the vault as claimable.
    function _pullFromVault() internal {
        if (vault.claimable(address(this)) > 0) vault.claim();
    }
}
