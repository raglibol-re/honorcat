// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @title VerdictVault
/// @notice Locks USDC in "pots" that are paid out to payees (by share) or refunded,
///         depending on an outcome signed by the pot's resolver.
/// @dev    No owner, no upgradeability, no admin functions. Every state change emits an event
///         because native USDC movements on Arc do not log at the ERC-20 address.
///
///         Refund model: on a `false` outcome or expiry the WHOLE pot goes to `refundTo`.
///         Third-party funders are NOT refunded individually. Per-funder refunds are a
///         possible later extension.
///
///         Failed transfers (e.g. a USDC-blocklisted recipient) do not block the pot: the
///         amount is credited to `claimable[recipient]` and can be withdrawn with `claim()`.
///
///         Gasless funding: Arc's USDC implements EIP-3009. A funder signs a
///         `ReceiveWithAuthorization` off-chain and anyone (typically the relay, paying gas in
///         USDC) submits it via `fundWithAuthorization` / `createPotWithAuthorization`. The 3009
///         nonce is derived from the pot (or the pot's parameters), so a submitter cannot
///         redirect a signed authorization to a different pot, and `receiveWithAuthorization`
///         requires `msg.sender == to`, so it cannot be front-run at the token level.
contract VerdictVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        None,
        Open,
        Resolved,
        Expired
    }

    enum PaymentKind {
        Payout,
        Refund
    }

    /// @notice Parameters of a pot, used by `createPotWithAuthorization`.
    struct PotParams {
        bytes32 conditionId;
        address resolver;
        address[] payees;
        uint16[] sharesBps;
        address refundTo;
        uint64 deadline;
    }

    /// @notice An EIP-3009 `ReceiveWithAuthorization` signed by `from` over
    ///         (from, to = this vault, value, validAfter, validBefore, nonce). The nonce is not
    ///         passed in: it is derived on-chain from `salt` and the pot it is meant for.
    struct Authorization {
        address from;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 salt;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct Pot {
        bytes32 conditionId;
        address resolver;
        address refundTo;
        uint64 deadline;
        Status status;
        bool outcome;
        uint256 total;
        address[] payees;
        uint16[] sharesBps;
    }

    // ---------------------------------------------------------------------
    // Constants / immutables
    // ---------------------------------------------------------------------

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PAYEES = 20;

    /// @dev EIP-712 domain (name, version, chainId, verifyingContract) binds a signature to this
    ///      chain and this contract; the struct binds it to one pot and one condition.
    bytes32 public constant RESOLUTION_TYPEHASH =
        keccak256("Resolution(uint256 potId,bytes32 conditionId,bool outcome)");

    /// @dev Domain tags for the derived EIP-3009 nonces.
    bytes32 public constant FUND_NONCE_TAG = keccak256("VerdictVault.fund");
    bytes32 public constant CREATE_NONCE_TAG = keccak256("VerdictVault.createAndFund");

    IERC20 public immutable usdc;
    uint256 public immutable gracePeriod;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint256 public potCount;
    mapping(uint256 potId => Pot) private _pots;
    mapping(address account => uint256) public claimable;
    uint256 public totalClaimable;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PotCreated(
        uint256 indexed potId,
        bytes32 indexed conditionId,
        address indexed creator,
        address resolver,
        address refundTo,
        uint64 deadline,
        address[] payees,
        uint16[] sharesBps
    );
    event PotFunded(uint256 indexed potId, address indexed funder, uint256 amount, uint256 newTotal);
    event PotResolved(uint256 indexed potId, bool outcome, uint256 total, address indexed submitter);
    event PotExpired(uint256 indexed potId, uint256 total);
    event Payout(uint256 indexed potId, address indexed payee, uint256 amount);
    event Refund(uint256 indexed potId, address indexed refundTo, uint256 amount);
    event PaymentDeferred(uint256 indexed potId, address indexed recipient, uint256 amount, PaymentKind kind);
    event Claimed(address indexed account, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidPayees();
    error InvalidShares();
    error DeadlineInPast();
    error PotNotOpen();
    error FundingClosed();
    error ZeroAmount();
    error NotFunded();
    error ResolutionWindowClosed();
    error NotExpirable();
    error InvalidSignature();
    error NothingToClaim();
    error TransferMismatch();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(IERC20 usdc_, uint256 gracePeriod_) EIP712("VerdictVault", "1") {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
        gracePeriod = gracePeriod_;
    }

    // ---------------------------------------------------------------------
    // Pot lifecycle
    // ---------------------------------------------------------------------

    /// @notice Register a pot. Anyone may create one.
    /// @param conditionId Opaque identifier of the external event (the relay maps it to a source).
    /// @param resolver    Address whose EIP-712 signature (EOA or ERC-1271) decides the outcome.
    /// @param payees      Recipients if the outcome is `true`.
    /// @param sharesBps   Share of each payee in basis points; must be > 0 each and sum to 10_000.
    /// @param refundTo    Recipient of the whole pot if the outcome is `false` or the pot expires.
    /// @param deadline    Unix time after which funding stops; resolution is allowed until
    ///                    `deadline + gracePeriod`, after which only `expire` works.
    function createPot(
        bytes32 conditionId,
        address resolver,
        address[] calldata payees,
        uint16[] calldata sharesBps,
        address refundTo,
        uint64 deadline
    ) external returns (uint256 potId) {
        potId = _createPot(msg.sender, conditionId, resolver, payees, sharesBps, refundTo, deadline);
    }

    /// @notice Create a pot and fund it in one transaction from an EIP-3009 authorization.
    ///         The funder (`auth.from`) becomes the pot's creator; the submitter only pays gas.
    /// @dev The authorization nonce must equal `createNonce(params, auth.salt)`, which commits to
    ///      every pot parameter, so the signature cannot be used for a pot with other terms.
    function createPotWithAuthorization(PotParams calldata params, uint256 amount, Authorization calldata auth)
        external
        nonReentrant
        returns (uint256 potId)
    {
        if (amount == 0) revert ZeroAmount();
        potId = _createPot(
            auth.from,
            params.conditionId,
            params.resolver,
            params.payees,
            params.sharesBps,
            params.refundTo,
            params.deadline
        );
        _pots[potId].total = amount;
        emit PotFunded(potId, auth.from, amount, amount);

        _receive(auth, amount, createNonce(params, auth.salt));
    }

    function _createPot(
        address creator,
        bytes32 conditionId,
        address resolver,
        address[] calldata payees,
        uint16[] calldata sharesBps,
        address refundTo,
        uint64 deadline
    ) private returns (uint256 potId) {
        if (resolver == address(0) || refundTo == address(0)) revert ZeroAddress();
        uint256 n = payees.length;
        if (n == 0 || n > MAX_PAYEES || n != sharesBps.length) revert InvalidPayees();
        if (deadline <= block.timestamp) revert DeadlineInPast();

        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (payees[i] == address(0)) revert ZeroAddress();
            if (sharesBps[i] == 0) revert InvalidShares();
            sum += sharesBps[i];
        }
        if (sum != BPS) revert InvalidShares();

        potId = ++potCount;
        Pot storage p = _pots[potId];
        p.conditionId = conditionId;
        p.resolver = resolver;
        p.refundTo = refundTo;
        p.deadline = deadline;
        p.status = Status.Open;
        p.payees = payees;
        p.sharesBps = sharesBps;

        _emitCreated(potId, creator, p);
    }

    /// @dev Separate frame to avoid stack-too-deep in createPot.
    function _emitCreated(uint256 potId, address creator, Pot storage p) private {
        emit PotCreated(potId, p.conditionId, creator, p.resolver, p.refundTo, p.deadline, p.payees, p.sharesBps);
    }

    /// @notice Add USDC to an open pot. Anyone may fund, repeatedly, until the deadline.
    /// @dev Caller must have approved this contract for `amount` on the USDC ERC-20 interface.
    function fund(uint256 potId, uint256 amount) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.status != Status.Open) revert PotNotOpen();
        if (block.timestamp > p.deadline) revert FundingClosed();
        if (amount == 0) revert ZeroAmount();

        uint256 newTotal = p.total + amount;
        p.total = newTotal;
        emit PotFunded(potId, msg.sender, amount, newTotal);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Fund an open pot from an EIP-3009 authorization signed by `auth.from`.
    ///         Anyone may submit; the funder needs no gas balance and no prior approve.
    /// @dev The authorization nonce must equal `fundNonce(potId, auth.salt)`.
    function fundWithAuthorization(uint256 potId, uint256 amount, Authorization calldata auth) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.status != Status.Open) revert PotNotOpen();
        if (block.timestamp > p.deadline) revert FundingClosed();
        if (amount == 0) revert ZeroAmount();

        uint256 newTotal = p.total + amount;
        p.total = newTotal;
        emit PotFunded(potId, auth.from, amount, newTotal);

        _receive(auth, amount, fundNonce(potId, auth.salt));
    }

    /// @notice Settle a pot with a result signed by its resolver. Anyone may submit.
    function resolve(uint256 potId, bool outcome, bytes calldata signature) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.status != Status.Open) revert PotNotOpen();
        if (block.timestamp > uint256(p.deadline) + gracePeriod) revert ResolutionWindowClosed();
        uint256 total = p.total;
        if (total == 0) revert NotFunded();

        bytes32 digest = resolutionDigest(potId, p.conditionId, outcome);
        if (!SignatureChecker.isValidSignatureNow(p.resolver, digest, signature)) revert InvalidSignature();

        // Effects before interactions.
        p.status = Status.Resolved;
        p.outcome = outcome;
        emit PotResolved(potId, outcome, total, msg.sender);

        if (outcome) {
            _distribute(potId, p, total);
        } else {
            _pay(potId, p.refundTo, total, PaymentKind.Refund);
        }
    }

    /// @notice Refund an unresolved pot once `deadline + gracePeriod` has passed. Anyone may call.
    function expire(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.status != Status.Open) revert PotNotOpen();
        if (block.timestamp <= uint256(p.deadline) + gracePeriod) revert NotExpirable();

        uint256 total = p.total;
        p.status = Status.Expired;
        emit PotExpired(potId, total);

        if (total > 0) _pay(potId, p.refundTo, total, PaymentKind.Refund);
    }

    /// @notice Withdraw amounts whose direct transfer failed earlier. Paid to the caller only.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        emit Claimed(msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getPot(uint256 potId) external view returns (Pot memory) {
        return _pots[potId];
    }

    /// @notice The EIP-712 digest the resolver must sign.
    function resolutionDigest(uint256 potId, bytes32 conditionId, bool outcome) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(RESOLUTION_TYPEHASH, potId, conditionId, outcome)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice The EIP-3009 nonce a funder must sign to fund `potId` via `fundWithAuthorization`.
    function fundNonce(uint256 potId, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(FUND_NONCE_TAG, block.chainid, address(this), potId, salt));
    }

    /// @notice The EIP-3009 nonce a funder must sign for `createPotWithAuthorization(params, ...)`.
    function createNonce(PotParams calldata params, bytes32 salt) public view returns (bytes32) {
        bytes32 paramsHash = keccak256(
            abi.encode(
                params.conditionId,
                params.resolver,
                keccak256(abi.encodePacked(params.payees)),
                keccak256(abi.encodePacked(params.sharesBps)),
                params.refundTo,
                params.deadline
            )
        );
        return keccak256(abi.encode(CREATE_NONCE_TAG, block.chainid, address(this), paramsHash, salt));
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /// @dev Each payee gets floor(total * bps / 10_000); the last payee receives the remainder,
    ///      so the sum of payouts is exactly `total` and no dust stays in the contract.
    function _distribute(uint256 potId, Pot storage p, uint256 total) private {
        uint256 n = p.payees.length;
        uint256 remaining = total;
        for (uint256 i; i < n; ++i) {
            uint256 amount = i == n - 1 ? remaining : (total * p.sharesBps[i]) / BPS;
            remaining -= amount;
            if (amount > 0) _pay(potId, p.payees[i], amount, PaymentKind.Payout);
        }
    }

    /// @dev Pulls `amount` from `auth.from` with EIP-3009. Reverts if the signature, validity
    ///      window, nonce or balance is wrong; the token marks the nonce as used.
    function _receive(Authorization calldata auth, uint256 amount, bytes32 nonce) private {
        uint256 before = usdc.balanceOf(address(this));
        IERC3009(address(usdc))
            .receiveWithAuthorization(
                auth.from, address(this), amount, auth.validAfter, auth.validBefore, nonce, auth.v, auth.r, auth.s
            );
        if (usdc.balanceOf(address(this)) != before + amount) revert TransferMismatch();
    }

    /// @dev Never reverts on a failed transfer: the amount becomes claimable instead.
    function _pay(uint256 potId, address to, uint256 amount, PaymentKind kind) private {
        if (usdc.trySafeTransfer(to, amount)) {
            if (kind == PaymentKind.Payout) emit Payout(potId, to, amount);
            else emit Refund(potId, to, amount);
        } else {
            claimable[to] += amount;
            totalClaimable += amount;
            emit PaymentDeferred(potId, to, amount, kind);
        }
    }
}
