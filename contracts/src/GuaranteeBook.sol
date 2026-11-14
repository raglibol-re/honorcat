// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VerdictVault} from "./VerdictVault.sol";

/// @title GuaranteeBook
/// @notice Turns one VerdictVault pot into a refund promise for up to MAX_CUSTOMERS customers,
///         each refunded an exact amount. The vault itself is unchanged: the pot's only payee is
///         this book and its refundTo is the merchant.
///
///         - Positive outcome: the vault pays the whole pot to the book; `payout` sends each enrolled
///           customer exactly `refundAmount` (anyone may call it, in batches) and returns the unused
///           seats' money to the merchant.
///         - Negative outcome or expiry: the vault refunds the merchant directly; the book does nothing.
///
///         Enrolment is done by the operator (the Verdict relay) until `lockTime`, which must be before
///         the pot's deadline. The operator is trusted not to enrol fake customers; a Merkle-root mode
///         can replace this list later. Seats are only sold while the pot covers them.
///
///         Failed transfers (e.g. a USDC-blocklisted customer) never block the others: the amount
///         becomes claimable, as in the vault.
contract GuaranteeBook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_CUSTOMERS = 50;

    struct Guarantee {
        uint256 potId;
        address merchant;
        uint128 refundAmount;
        uint32 maxCustomers;
        uint32 enrolled;
        uint32 paidCursor; // customers[0..paidCursor) have been paid (or deferred)
        uint64 lockTime;
        bool settled; // payout completed incl. leftover
    }

    VerdictVault public immutable vault;
    IERC20 public immutable usdc;
    address public immutable operator;

    uint256 public guaranteeCount;
    mapping(uint256 gid => Guarantee) internal _guarantees;
    mapping(uint256 gid => address[]) internal _customers;
    mapping(uint256 gid => mapping(address => bool)) public isCustomer;
    mapping(uint256 potId => uint256 gid) public guaranteeOfPot;
    mapping(address account => uint256) public claimable;
    uint256 public totalClaimable;

    event GuaranteeOpened(
        uint256 indexed gid,
        uint256 indexed potId,
        address indexed merchant,
        uint128 refundAmount,
        uint32 maxCustomers,
        uint64 lockTime
    );
    event Enrolled(uint256 indexed gid, address indexed account, uint32 seat);
    event RefundPaid(uint256 indexed gid, address indexed account, uint256 amount);
    event RefundDeferred(uint256 indexed gid, address indexed account, uint256 amount);
    event LeftoverReturned(uint256 indexed gid, address indexed merchant, uint256 amount);
    event Claimed(address indexed account, uint256 amount);

    error NotOperator();
    error InvalidPot();
    error AlreadyOpened();
    error InvalidTerms();
    error UnknownGuarantee();
    error EnrolmentClosed();
    error AlreadyEnrolled();
    error Full();
    error NotCovered();
    error NotTriggered();
    error AlreadySettled();
    error NothingToClaim();

    constructor(VerdictVault vault_, address operator_) {
        if (address(vault_) == address(0) || operator_ == address(0)) revert InvalidTerms();
        vault = vault_;
        usdc = vault_.usdc();
        operator = operator_;
    }

    // ------------------------------------------------------------------ setup

    /// @notice Attaches refund terms to an open pot whose only payee is this book.
    ///         Callable by the operator or the merchant (the pot's refundTo).
    function open(uint256 potId, uint128 refundAmount, uint32 maxCustomers, uint64 lockTime)
        external
        returns (uint256 gid)
    {
        VerdictVault.Pot memory p = vault.getPot(potId);
        if (p.status != VerdictVault.Status.Open) revert InvalidPot();
        if (p.payees.length != 1 || p.payees[0] != address(this) || p.sharesBps[0] != 10_000) revert InvalidPot();
        if (msg.sender != operator && msg.sender != p.refundTo) revert NotOperator();
        if (guaranteeOfPot[potId] != 0) revert AlreadyOpened();
        if (refundAmount == 0 || maxCustomers == 0 || maxCustomers > MAX_CUSTOMERS) revert InvalidTerms();
        if (lockTime <= block.timestamp || lockTime >= p.deadline) revert InvalidTerms();

        gid = ++guaranteeCount;
        _guarantees[gid] = Guarantee({
            potId: potId,
            merchant: p.refundTo,
            refundAmount: refundAmount,
            maxCustomers: maxCustomers,
            enrolled: 0,
            paidCursor: 0,
            lockTime: lockTime,
            settled: false
        });
        guaranteeOfPot[potId] = gid;
        emit GuaranteeOpened(gid, potId, p.refundTo, refundAmount, maxCustomers, lockTime);
    }

    /// @notice Enrols a customer. Only before lockTime, only while the pot covers every seat sold.
    function enrol(uint256 gid, address account) external {
        if (msg.sender != operator) revert NotOperator();
        Guarantee storage g = _guarantee(gid);
        if (account == address(0)) revert InvalidTerms();
        if (block.timestamp >= g.lockTime) revert EnrolmentClosed();
        VerdictVault.Pot memory p = vault.getPot(g.potId);
        if (p.status != VerdictVault.Status.Open) revert EnrolmentClosed();
        if (isCustomer[gid][account]) revert AlreadyEnrolled();
        if (g.enrolled >= g.maxCustomers) revert Full();
        uint32 seat = g.enrolled + 1;
        if (uint256(seat) * g.refundAmount > p.total) revert NotCovered();

        g.enrolled = seat;
        isCustomer[gid][account] = true;
        _customers[gid].push(account);
        emit Enrolled(gid, account, seat);
    }

    // ------------------------------------------------------------------ settlement

    /// @notice After a positive outcome, refunds up to `maxCount` customers; the last batch also
    ///         returns unused seats' money to the merchant. Anyone may call.
    function payout(uint256 gid, uint256 maxCount) external nonReentrant returns (uint256 paid) {
        Guarantee storage g = _guarantee(gid);
        if (g.settled) revert AlreadySettled();
        VerdictVault.Pot memory p = vault.getPot(g.potId);
        if (p.status != VerdictVault.Status.Resolved || !p.outcome) revert NotTriggered();

        // If the vault could not transfer to the book, the pot sits in the vault as claimable.
        if (vault.claimable(address(this)) > 0) vault.claim();

        address[] storage list = _customers[gid];
        uint256 end = g.paidCursor + maxCount;
        if (end > list.length) end = list.length;
        uint256 amount = g.refundAmount;
        for (uint256 i = g.paidCursor; i < end; ++i) {
            _send(gid, list[i], amount, false);
            ++paid;
        }
        g.paidCursor = uint32(end);

        if (end == list.length) {
            g.settled = true;
            uint256 leftover = p.total - uint256(list.length) * amount;
            if (leftover > 0) _send(gid, g.merchant, leftover, true);
        }
    }

    /// @notice Withdraws amounts whose direct transfer failed. Paid to the caller only.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        emit Claimed(msg.sender, amount);
        usdc.safeTransfer(msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    function getGuarantee(uint256 gid) external view returns (Guarantee memory) {
        return _guarantees[gid];
    }

    function customers(uint256 gid) external view returns (address[] memory) {
        return _customers[gid];
    }

    // ------------------------------------------------------------------ internal

    function _guarantee(uint256 gid) internal view returns (Guarantee storage g) {
        g = _guarantees[gid];
        if (g.potId == 0) revert UnknownGuarantee();
    }

    function _send(uint256 gid, address to, uint256 amount, bool leftover) internal {
        if (usdc.trySafeTransfer(to, amount)) {
            if (leftover) emit LeftoverReturned(gid, to, amount);
            else emit RefundPaid(gid, to, amount);
        } else {
            claimable[to] += amount;
            totalClaimable += amount;
            emit RefundDeferred(gid, to, amount);
        }
    }
}
