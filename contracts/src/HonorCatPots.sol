// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @title  HonorCatPots
/// @notice Two sides, one pot, one Gemini prediction contract, fully collateralised in USDC.
///         Side YES gets the pot if the event happens, side NO if not. Each side's share follows
///         the market price; either side may leave at a forward-priced fair value. The contract never
///         reads a price itself: it accepts attestations signed by the pot's signer set (an ERC-1271
///         M-of-N resolver, fixed per pot) and checks them strictly. Anyone may submit them.
/// @dev    Design: docs/pot-design.md. Prices in ppm (P = 1e6) of the YES probability. Amounts in
///         USDC base units (6 decimals). One split rule everywhere: YES gets floor(n·p/P), NO the rest.
contract HonorCatPots is ERC721, EIP712, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants and types

    uint256 public constant P = 1_000_000; // ppm
    uint32 public constant MAX_TOLERANCE = 50_000; // 5 points
    uint64 public constant DELAY = 1; // a window starts 1 s after its request
    uint64 public constant MIN_GRACE = 1 days;
    uint64 public constant ATTEST_TIMEOUT = 10 minutes; // a window with no attestation by then can be abandoned
    uint64 public constant COOLDOWN = 2 minutes; // after a failed exit
    uint64 public constant MIN_LOCKOUT = 2 minutes;
    uint32 public constant MIN_WINDOW = 10;
    uint32 public constant MAX_WINDOW = 600;
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;

    uint8 public constant YES = 0;
    uint8 public constant NO = 1;

    uint8 public constant KIND_JOIN = 0;
    uint8 public constant KIND_EXIT = 1;

    uint8 public constant OUTCOME_NO = 0;
    uint8 public constant OUTCOME_YES = 1;
    uint8 public constant OUTCOME_VOID = 2;

    enum State {
        None,
        Open,
        Joining,
        Live,
        ExitRequested,
        Divided,
        Settled,
        Expired
    }

    struct Pot {
        bytes32 conditionId; // Gemini contract + rule (keccak of engine version, instrument, params)
        address resolver; // ERC-1271 signer set, fixed for life
        uint256 notional; // N
        uint256 depYes; // deposits backing each side while Live; depYes + depNo = N
        uint256 depNo;
        uint256 escrowYes; // what each side paid in while Open / Joining (worst case of the band)
        uint256 escrowNo;
        uint32 bandCenter; // ppm
        uint32 tolerance; // ppm
        uint32 window; // seconds
        uint32 minSamples;
        uint16 feeBps;
        uint8 creatorSide;
        State state;
        uint64 closeTime;
        uint64 deadline;
        uint64 cooldownUntil;
        uint64 nonce; // increments with every join or exit request
        // pending join or exit
        address joiner;
        uint8 exitSide;
        uint64 requestTime;
        uint256 exitNotional;
    }

    struct CreateParams {
        bytes32 conditionId;
        address resolver;
        uint8 side;
        uint256 notional;
        uint32 bandCenter;
        uint32 tolerance;
        uint64 closeTime;
        uint64 grace;
        uint32 window;
        uint32 minSamples;
    }

    /// @notice EIP-3009 authorization (Arc USDC receiveWithAuthorization). v = 0 means "pull with
    ///         transferFrom from msg.sender instead".
    struct Authorization {
        address from;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 salt;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice A window average attested by the pot's signer set.
    struct WindowAttestation {
        uint256 potId;
        uint8 kind; // KIND_JOIN or KIND_EXIT
        uint64 nonce;
        uint64 windowStart;
        uint64 windowEnd;
        uint32 sampleCount;
        uint32 priceYes; // ppm
        bool valid;
        bytes32 evidenceHash;
    }

    struct OutcomeAttestation {
        uint256 potId;
        bytes32 conditionId;
        uint8 outcome;
        bytes32 evidenceHash;
    }

    bytes32 public constant WINDOW_TYPEHASH = keccak256(
        "Window(uint256 potId,uint8 kind,uint64 nonce,uint64 windowStart,uint64 windowEnd,uint32 sampleCount,uint32 priceYes,bool valid,bytes32 evidenceHash)"
    );
    bytes32 public constant OUTCOME_TYPEHASH =
        keccak256("Outcome(uint256 potId,bytes32 conditionId,uint8 outcome,bytes32 evidenceHash)");
    bytes32 public constant EXIT_REQUEST_TYPEHASH =
        keccak256("ExitRequest(uint256 potId,uint8 side,uint256 notional,uint256 sigNonce,uint256 deadline)");
    bytes32 public constant DEPOSIT_TAG = keccak256("HonorCatPots.deposit");

    // ---------------------------------------------------------------- storage

    IERC20 public immutable usdc;
    uint256 public nextPotId = 1;
    bool public paused;
    uint16 public feeBps = 100; // 1% of the exited notional, copied into each new pot
    uint256 public globalMaxNotional = 25e6; // $25 on testnet

    mapping(uint256 => Pot) internal _pots;
    mapping(uint256 => uint256) public sigNonce; // per token, for owner signatures
    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    // ---------------------------------------------------------------- events

    event PotCreated(uint256 indexed potId, address indexed creator, uint8 side, uint256 notional, uint32 bandCenter, uint32 tolerance, uint256 escrow);
    event JoinRequested(uint256 indexed potId, address indexed joiner, uint64 nonce, uint64 requestTime, uint256 escrow);
    event Joined(uint256 indexed potId, uint32 entryPrice, uint256 depYes, uint256 depNo, bytes32 evidenceHash);
    event JoinFailed(uint256 indexed potId, uint64 nonce, bytes32 evidenceHash);
    event ExitRequested(uint256 indexed potId, uint8 side, uint256 notional, uint64 nonce, uint64 requestTime);
    event ExitFailed(uint256 indexed potId, uint64 nonce, bytes32 evidenceHash);
    event PotDivided(uint256 indexed potId, uint8 exitSide, uint256 notional, uint32 price, uint256 paidYes, uint256 paidNo, uint256 fee, bytes32 evidenceHash);
    event PotSettled(uint256 indexed potId, uint8 outcome, uint256 paidYes, uint256 paidNo, bytes32 evidenceHash);
    event PotExpired(uint256 indexed potId, uint256 paidYes, uint256 paidNo);
    event Paid(uint256 indexed potId, address indexed to, uint256 amount);
    event PaymentDeferred(uint256 indexed potId, address indexed to, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Paused(bool paused);

    // ---------------------------------------------------------------- errors

    error PausedForNewPots();
    error BadParams();
    error WrongState();
    error NotOwner();
    error TooLate();
    error TooEarly();
    error InvalidAttestation();
    error OutsideBand();
    error Cooldown();
    error TransferMismatch();
    error ExpiredSignature();
    error NothingToWithdraw();

    constructor(IERC20 usdc_, address owner_) ERC721("HonorCat pot side", "HCSIDE") EIP712("HonorCatPots", "1") Ownable(owner_) {
        usdc = usdc_;
    }

    // ---------------------------------------------------------------- the split rule

    /// @notice YES's part of `n` at YES price `p` (ppm): floor(n·p/P). NO gets n minus this.
    function yesPart(uint256 n, uint256 p) public pure returns (uint256) {
        return (n * p) / P;
    }

    function noPart(uint256 n, uint256 p) public pure returns (uint256) {
        return n - yesPart(n, p);
    }

    /// @notice The most a side can owe for `n` anywhere in the band [c − t, c + t] (clamped to [0, P]).
    function worstCase(uint8 side, uint256 n, uint32 c, uint32 t) public pure returns (uint256) {
        if (side == YES) return yesPart(n, uint256(c) + t > P ? P : uint256(c) + t);
        return noPart(n, t > c ? 0 : c - t);
    }

    // ---------------------------------------------------------------- views

    function pot(uint256 potId) external view returns (Pot memory) {
        return _pots[potId];
    }

    function tokenOf(uint256 potId, uint8 side) public pure returns (uint256) {
        return potId * 2 + side;
    }

    function lockout(uint256 potId) public view returns (uint64) {
        uint64 l = DELAY + uint64(_pots[potId].window) + 60;
        return l > MIN_LOCKOUT ? l : MIN_LOCKOUT;
    }

    /// @notice EIP-712 digest the signer set signs for a window average.
    function windowDigest(WindowAttestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    WINDOW_TYPEHASH, a.potId, a.kind, a.nonce, a.windowStart, a.windowEnd, a.sampleCount, a.priceYes, a.valid, a.evidenceHash
                )
            )
        );
    }

    /// @notice EIP-712 digest the signer set signs for a settlement.
    function outcomeDigest(OutcomeAttestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(OUTCOME_TYPEHASH, a.potId, a.conditionId, a.outcome, a.evidenceHash)));
    }

    /// @notice EIP-712 digest a side owner signs to request an exit without paying gas.
    function exitRequestDigest(uint256 potId, uint8 side, uint256 notional, uint256 deadline) public view returns (bytes32) {
        uint256 tokenId = tokenOf(potId, side);
        return _hashTypedDataV4(keccak256(abi.encode(EXIT_REQUEST_TYPEHASH, potId, side, notional, sigNonce[tokenId], deadline)));
    }

    // ---------------------------------------------------------------- admin (new pots only)

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    function setFeeBps(uint16 bps) external onlyOwner {
        if (bps > 500) revert BadParams();
        feeBps = bps;
    }

    function setGlobalMaxNotional(uint256 max) external onlyOwner {
        globalMaxNotional = max;
    }

    // ---------------------------------------------------------------- create / join

    /// @notice Offers a pot. The creator escrows its side's worst case in the band; the entry price
    ///         is set later, forward-priced, when someone joins.
    function create(CreateParams calldata c, Authorization calldata auth) external nonReentrant returns (uint256 potId) {
        if (paused) revert PausedForNewPots();
        if (
            c.side > NO || c.notional == 0 || c.notional > globalMaxNotional || c.resolver == address(0)
                || c.bandCenter > P || c.tolerance > MAX_TOLERANCE || c.grace < MIN_GRACE || c.window < MIN_WINDOW
                || c.window > MAX_WINDOW || c.minSamples == 0
        ) revert BadParams();
        potId = nextPotId++;
        Pot storage p = _pots[potId];
        p.conditionId = c.conditionId;
        p.resolver = c.resolver;
        p.notional = c.notional;
        p.bandCenter = c.bandCenter;
        p.tolerance = c.tolerance;
        p.window = c.window;
        p.minSamples = c.minSamples;
        p.feeBps = feeBps;
        p.creatorSide = c.side;
        p.closeTime = c.closeTime;
        p.deadline = c.closeTime + c.grace;
        if (block.timestamp + lockout(potId) >= c.closeTime) revert TooLate();
        p.state = State.Open;

        address creator = _payer(auth);
        uint256 escrow = worstCase(c.side, c.notional, c.bandCenter, c.tolerance);
        if (c.side == YES) p.escrowYes = escrow;
        else p.escrowNo = escrow;
        _pull(creator, escrow, keccak256(abi.encode("create", creator, c)), auth);
        _mint(creator, tokenOf(potId, c.side));
        emit PotCreated(potId, creator, c.side, c.notional, c.bandCenter, c.tolerance, escrow);
    }

    /// @notice Requests to join as the other side, escrowing that side's worst case in the band. Binding:
    ///         the entry price is the window average after this request.
    function requestJoin(uint256 potId, Authorization calldata auth) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.Open) revert WrongState();
        if (block.timestamp + lockout(potId) >= p.closeTime) revert TooLate();
        address joiner = _payer(auth);
        uint8 side = 1 - p.creatorSide;
        uint256 escrow = worstCase(side, p.notional, p.bandCenter, p.tolerance);
        if (side == YES) p.escrowYes = escrow;
        else p.escrowNo = escrow;
        p.joiner = joiner;
        p.requestTime = uint64(block.timestamp);
        p.nonce += 1;
        p.state = State.Joining;
        _pull(joiner, escrow, keccak256(abi.encode("join", potId, joiner, p.nonce)), auth);
        emit JoinRequested(potId, joiner, p.nonce, p.requestTime, escrow);
    }

    /// @notice Completes a join at the attested entry price, or (valid = false or outside the band)
    ///         sends the pot back to Open and refunds the joiner.
    function resolveJoin(WindowAttestation calldata a, bytes calldata sigs) external nonReentrant {
        Pot storage p = _pots[a.potId];
        if (p.state != State.Joining) revert WrongState();
        _checkWindow(p, a, KIND_JOIN, sigs);
        uint256 lo = p.tolerance > p.bandCenter ? 0 : p.bandCenter - p.tolerance;
        uint256 hi = uint256(p.bandCenter) + p.tolerance;
        if (!a.valid || a.priceYes < lo || a.priceYes > hi) {
            _failJoin(a.potId, p, a.evidenceHash);
            return;
        }
        uint256 n = p.notional;
        uint256 dy = yesPart(n, a.priceYes);
        uint256 dn = n - dy;
        uint256 refundYes = p.escrowYes - dy; // >= 0: price inside the band, split monotonic
        uint256 refundNo = p.escrowNo - dn;
        p.depYes = dy;
        p.depNo = dn;
        p.escrowYes = 0;
        p.escrowNo = 0;
        p.state = State.Live;
        address joiner = p.joiner;
        p.joiner = address(0);
        uint8 joinSide = 1 - p.creatorSide;
        _mint(joiner, tokenOf(a.potId, joinSide));
        emit Joined(a.potId, a.priceYes, dy, dn, a.evidenceHash);
        if (refundYes > 0) _pay(a.potId, ownerOf(tokenOf(a.potId, YES)), refundYes);
        if (refundNo > 0) _pay(a.potId, ownerOf(tokenOf(a.potId, NO)), refundNo);
    }

    /// @notice A join whose window never got an attestation in time can be abandoned by anyone.
    function abandonJoin(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.Joining) revert WrongState();
        if (block.timestamp <= p.requestTime + DELAY + p.window + ATTEST_TIMEOUT) revert TooEarly();
        _failJoin(potId, p, bytes32(0));
    }

    function _failJoin(uint256 potId, Pot storage p, bytes32 evidenceHash) internal {
        uint8 joinSide = 1 - p.creatorSide;
        uint256 refund = joinSide == YES ? p.escrowYes : p.escrowNo;
        if (joinSide == YES) p.escrowYes = 0;
        else p.escrowNo = 0;
        address joiner = p.joiner;
        p.joiner = address(0);
        p.state = State.Open;
        emit JoinFailed(potId, p.nonce, evidenceHash);
        _pay(potId, joiner, refund);
    }

    /// @notice Withdraws an offer nobody has joined: the creator any time, anyone after trading closes.
    function cancel(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.Open) revert WrongState();
        address creator = ownerOf(tokenOf(potId, p.creatorSide));
        if (msg.sender != creator && block.timestamp < p.closeTime) revert NotOwner();
        _refundEscrowsAndExpire(potId, p);
    }

    // ---------------------------------------------------------------- exit

    /// @notice Files a binding exit request for `side` (the caller must own that side's token).
    function requestExit(uint256 potId, uint8 side, uint256 notional) external {
        if (msg.sender != ownerOf(tokenOf(potId, side))) revert NotOwner();
        _requestExit(potId, side, notional);
    }

    /// @notice Same, authorised by the side owner's EIP-712 signature (EOA or ERC-1271 passkey account),
    ///         submitted by anyone, so the owner pays no gas.
    function requestExitFor(uint256 potId, uint8 side, uint256 notional, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert ExpiredSignature();
        uint256 tokenId = tokenOf(potId, side);
        address owner_ = ownerOf(tokenId);
        if (!SignatureChecker.isValidSignatureNow(owner_, exitRequestDigest(potId, side, notional, deadline), sig)) revert NotOwner();
        sigNonce[tokenId] += 1;
        _requestExit(potId, side, notional);
    }

    function _requestExit(uint256 potId, uint8 side, uint256 notional) internal {
        Pot storage p = _pots[potId];
        if (p.state != State.Live) revert WrongState();
        if (side > NO || notional == 0 || notional > p.notional) revert BadParams();
        if (notional != p.notional) revert BadParams(); // partial exits: later step
        if (block.timestamp + lockout(potId) >= p.closeTime) revert TooLate();
        if (block.timestamp < p.cooldownUntil) revert Cooldown();
        p.exitSide = side;
        p.exitNotional = notional;
        p.requestTime = uint64(block.timestamp);
        p.nonce += 1;
        p.state = State.ExitRequested;
        emit ExitRequested(potId, side, notional, p.nonce, p.requestTime);
    }

    /// @notice Prices the pending exit with the attested window average and divides the pot, or (valid =
    ///         false: too few samples, market halted, under review or failing the rule) lets it continue.
    function resolveExit(WindowAttestation calldata a, bytes calldata sigs) external nonReentrant {
        Pot storage p = _pots[a.potId];
        if (p.state != State.ExitRequested) revert WrongState();
        _checkWindow(p, a, KIND_EXIT, sigs);
        if (!a.valid) {
            p.state = State.Live;
            p.cooldownUntil = uint64(block.timestamp) + COOLDOWN;
            emit ExitFailed(a.potId, p.nonce, a.evidenceHash);
            return;
        }
        _divide(a.potId, p, p.exitSide, p.exitNotional, a.priceYes, p.feeBps, a.evidenceHash);
    }

    /// @notice An exit window that got no attestation in time can be abandoned by anyone; the pot continues.
    function abandonExit(uint256 potId) external {
        Pot storage p = _pots[potId];
        if (p.state != State.ExitRequested) revert WrongState();
        if (block.timestamp <= p.requestTime + DELAY + p.window + ATTEST_TIMEOUT) revert TooEarly();
        p.state = State.Live;
        p.cooldownUntil = uint64(block.timestamp) + COOLDOWN;
        emit ExitFailed(potId, p.nonce, bytes32(0));
    }

    /// @dev Divides `n` of the pot at YES price `price` (docs/pot-design.md 3.3). Exact: paid sums to n.
    function _divide(uint256 potId, Pot storage p, uint8 exitSide, uint256 n, uint32 price, uint16 fee_, bytes32 evidenceHash) internal {
        uint256 cashYes = yesPart(n, price);
        uint256 cashNo = n - cashYes;
        uint256 cashExit = exitSide == YES ? cashYes : cashNo;
        uint256 fee = (n * fee_ + 9_999) / 10_000;
        if (fee > cashExit) fee = cashExit;
        uint256 payYes = exitSide == YES ? cashYes - fee : cashYes + fee;
        uint256 payNo = exitSide == NO ? cashNo - fee : cashNo + fee;

        uint256 nNew = p.notional - n;
        uint256 dy = p.depYes - (p.depYes * n) / p.notional;
        p.notional = nNew;
        p.depYes = dy;
        p.depNo = nNew - dy;
        p.state = nNew == 0 ? State.Divided : State.Live;

        address yesOwner = ownerOf(tokenOf(potId, YES));
        address noOwner = ownerOf(tokenOf(potId, NO));
        emit PotDivided(potId, exitSide, n, price, payYes, payNo, fee, evidenceHash);
        if (payYes > 0) _pay(potId, yesOwner, payYes);
        if (payNo > 0) _pay(potId, noOwner, payNo);
    }

    // ---------------------------------------------------------------- settle / expire

    /// @notice Ends a pot nobody left, on the signer set's attestation of Gemini's settlement: the
    ///         winner gets N; a voided market returns the deposits. A pending exit is dropped.
    function settle(OutcomeAttestation calldata a, bytes calldata sigs) external nonReentrant {
        Pot storage p = _pots[a.potId];
        if (p.state != State.Live && p.state != State.ExitRequested) revert WrongState();
        if (block.timestamp < p.closeTime) revert TooEarly();
        if (a.conditionId != p.conditionId || a.outcome > OUTCOME_VOID) revert InvalidAttestation();
        if (!SignatureChecker.isValidERC1271SignatureNow(p.resolver, outcomeDigest(a), sigs)) revert InvalidAttestation();

        uint256 n = p.notional;
        uint256 payYes;
        uint256 payNo;
        if (a.outcome == OUTCOME_YES) payYes = n;
        else if (a.outcome == OUTCOME_NO) payNo = n;
        else (payYes, payNo) = (p.depYes, p.depNo);
        p.notional = 0;
        p.depYes = 0;
        p.depNo = 0;
        p.state = a.outcome == OUTCOME_VOID ? State.Expired : State.Settled;
        emit PotSettled(a.potId, a.outcome, payYes, payNo, a.evidenceHash);
        if (payYes > 0) _pay(a.potId, ownerOf(tokenOf(a.potId, YES)), payYes);
        if (payNo > 0) _pay(a.potId, ownerOf(tokenOf(a.potId, NO)), payNo);
    }

    /// @notice After the deadline anyone can end any pot that is still running: deposits (or escrows)
    ///         go back. This is the path that guarantees no funds are ever stranded.
    function expire(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        State s = p.state;
        if (s == State.None || s == State.Divided || s == State.Settled || s == State.Expired) revert WrongState();
        if (block.timestamp < p.deadline) revert TooEarly();
        if (s == State.Open || s == State.Joining) {
            if (s == State.Joining) {
                // refund the joiner's escrow too
                uint8 joinSide = 1 - p.creatorSide;
                uint256 r = joinSide == YES ? p.escrowYes : p.escrowNo;
                if (joinSide == YES) p.escrowYes = 0;
                else p.escrowNo = 0;
                address joiner = p.joiner;
                p.joiner = address(0);
                if (r > 0) _pay(potId, joiner, r);
            }
            _refundEscrowsAndExpire(potId, p);
            return;
        }
        (uint256 payYes, uint256 payNo) = (p.depYes, p.depNo);
        p.notional = 0;
        p.depYes = 0;
        p.depNo = 0;
        p.state = State.Expired;
        emit PotExpired(potId, payYes, payNo);
        if (payYes > 0) _pay(potId, ownerOf(tokenOf(potId, YES)), payYes);
        if (payNo > 0) _pay(potId, ownerOf(tokenOf(potId, NO)), payNo);
    }

    function _refundEscrowsAndExpire(uint256 potId, Pot storage p) internal {
        uint8 cs = p.creatorSide;
        uint256 r = cs == YES ? p.escrowYes : p.escrowNo;
        p.escrowYes = 0;
        p.escrowNo = 0;
        p.notional = 0;
        p.state = State.Expired;
        address creator = ownerOf(tokenOf(potId, cs));
        emit PotExpired(potId, cs == YES ? r : 0, cs == NO ? r : 0);
        if (r > 0) _pay(potId, creator, r);
    }

    // ---------------------------------------------------------------- withdrawals

    /// @notice Withdraws amounts whose direct transfer failed (e.g. a blocklisted recipient).
    function withdraw() external nonReentrant {
        uint256 a = claimable[msg.sender];
        if (a == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;
        totalClaimable -= a;
        usdc.safeTransfer(msg.sender, a);
        emit Withdrawn(msg.sender, a);
    }

    // ---------------------------------------------------------------- internals

    function _checkWindow(Pot storage p, WindowAttestation calldata a, uint8 kind, bytes calldata sigs) internal view {
        if (a.kind != kind || a.nonce != p.nonce) revert InvalidAttestation();
        if (a.windowStart != p.requestTime + DELAY || a.windowEnd != a.windowStart + p.window) revert InvalidAttestation();
        if (a.windowEnd > block.timestamp) revert TooEarly();
        if (a.priceYes > P) revert InvalidAttestation();
        if (a.valid && a.sampleCount < p.minSamples) revert InvalidAttestation();
        if (!SignatureChecker.isValidERC1271SignatureNow(p.resolver, windowDigest(a), sigs)) revert InvalidAttestation();
    }

    function _payer(Authorization calldata auth) internal view returns (address) {
        return auth.v == 0 ? msg.sender : auth.from;
    }

    /// @dev Pulls `amount` from `from`: with the EIP-3009 authorization (nonce bound to this action,
    ///      so a relayer cannot redirect it), or with transferFrom from msg.sender.
    function _pull(address from, uint256 amount, bytes32 action, Authorization calldata auth) internal {
        uint256 before = usdc.balanceOf(address(this));
        if (auth.v == 0) {
            usdc.safeTransferFrom(msg.sender, address(this), amount);
        } else {
            bytes32 nonce = keccak256(abi.encode(DEPOSIT_TAG, block.chainid, address(this), action, auth.salt));
            IERC3009(address(usdc)).receiveWithAuthorization(
                from, address(this), amount, auth.validAfter, auth.validBefore, nonce, auth.v, auth.r, auth.s
            );
        }
        if (usdc.balanceOf(address(this)) != before + amount) revert TransferMismatch();
    }

    /// @notice The EIP-3009 nonce a depositor signs for an action (see `_pull`).
    function depositNonce(bytes32 action, bytes32 salt) external view returns (bytes32) {
        return keccak256(abi.encode(DEPOSIT_TAG, block.chainid, address(this), action, salt));
    }

    /// @dev Never reverts on a failed transfer: the amount becomes claimable instead.
    function _pay(uint256 potId, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (ok && (ret.length == 0 || abi.decode(ret, (bool)))) {
            emit Paid(potId, to, amount);
        } else {
            claimable[to] += amount;
            totalClaimable += amount;
            emit PaymentDeferred(potId, to, amount);
        }
    }

    // ---------------------------------------------------------------- token transfer rules

    /// @dev Positions move freely, except the exiting side's token while its exit window is open.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            Pot storage p = _pots[tokenId / 2];
            if (p.state == State.ExitRequested && p.exitSide == uint8(tokenId % 2)) revert WrongState();
        }
        return super._update(to, tokenId, auth);
    }
}
