// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC3009} from "../interfaces/IERC3009.sol";

/// @title  RopesBase
/// @notice Storage, types, constants, events and the shared internal logic of HonorCat v2. Inherited by
///         HonorCatRopes (the pot address, which holds every dollar) and HonorCatRopesExtension (code
///         the pot address runs by delegatecall). Both share this exact storage layout.
/// @dev    Design: docs/rope-design.md. Units: prices in ppm (P = 1e6) of the YES probability; posts
///         and the entry price on a 100 ppm grid (one tick = 0.01 points); size in hundredths of a
///         contract (one contract pays $1 across the full range). One tick × one hundredth = one USDC
///         base unit, so every share is ticks × size: exact, no division, and the two shares always
///         sum to the pot. Only fees (floor) and the copycat hold-back (ceil) round.
abstract contract RopesBase is ERC721, EIP712, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants

    uint256 public constant P = 1_000_000; // ppm
    uint256 public constant TICK = 100; // ppm per tick (0.01 points)
    uint32 public constant MAX_TOLERANCE = 50_000; // 5 points
    uint64 public constant DELAY = 1;
    uint64 public constant MIN_GRACE = 1 days;
    uint64 public constant ATTEST_TIMEOUT = 10 minutes;
    uint64 public constant COOLDOWN = 2 minutes;
    uint64 public constant MIN_LOCKOUT = 2 minutes;
    uint32 public constant MIN_WINDOW = 10;
    uint32 public constant MAX_WINDOW = 600;

    // Short ropes (decisions of 2026-11-18)
    uint64 public constant EXPIRY_LEAD = 2 hours; // expiry at least this long before trading closes
    uint64 public constant MAX_LIFE = 7 days;
    uint64 public constant MIN_LIFE = 10 minutes;
    uint32 public constant MIN_DISTANCE = 50_000; // 5 points; and at least twice the attested spread
    uint256 public constant MAX_LEVERAGE_CRYPTO = 10;
    uint256 public constant MAX_LEVERAGE_OTHER = 5;
    uint8 public constant MAX_LIVES = 8;
    uint8 public constant EXPIRY_TRIES = 4; // the expiry window and up to three fixed retries

    // Fees and treats: constants fixed at deploy, no setter. Every fee goes to a player.
    uint256 public constant BPS = 10_000;
    uint256 public constant OPERATOR_FEE_BPS = 0; // nothing goes to HonorCat; there is no operator recipient
    uint256 public constant EXIT_FEE_BPS = 100; // 1% of the pot value exited, to the side that stays
    uint256 public constant MAKER_TREAT_BPS = 25; // 0.25% of the joiner's deposit, to the opener
    uint256 public constant REFERRAL_SHARE_BPS = 2_000; // 20% of every fee an account pays...
    uint256 public constant REFERRAL_POTS = 20; // ...in its first 20 pots, to its referrer
    uint256 public constant COPYCAT_BPS = 500; // 5% of a copier's profit, to the leader

    /// @notice Cap: size ≤ 0.25 × contracts within 5¢ on the thinner side (both in hundredths).
    uint256 public constant CAP_DIVISOR = 4;

    uint8 public constant YES = 0;
    uint8 public constant NO = 1;

    uint8 public constant KIND_JOIN = 0;
    uint8 public constant KIND_EXIT = 1; // also prices a knock-out's forward window
    uint8 public constant KIND_NET = 2; // NET_YES = 2, NET_NO = 3
    uint8 public constant KIND_BOWL = 4; // BOWL_YES = 4, BOWL_NO = 5
    // 6 is the relay's QUOTE kind and is accepted nowhere: a quote can never move money.
    uint8 public constant KIND_KNOCK = 7;
    uint8 public constant KIND_EXPIRY = 8;

    uint8 public constant OUTCOME_NO = 0;
    uint8 public constant OUTCOME_YES = 1;
    uint8 public constant OUTCOME_VOID = 2;

    // PotDivided reasons
    uint8 internal constant R_EXIT = 0;
    uint8 internal constant R_KNOCK = 1;
    uint8 internal constant R_EXPIRY = 2;
    uint8 internal constant R_HANDSHAKE = 3;

    // ---------------------------------------------------------------- types

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
        bytes32 conditionId;
        address resolver; // ERC-1271 signer set, fixed for life
        uint256 size; // hundredths of a contract; shrinks on partial exits
        uint256 escrowYes; // paid in while Open / Joining (worst case of the band, plus the maker treat)
        uint256 escrowNo;
        uint32 bandCenter; // ppm
        uint32 tolerance; // ppm
        uint32 window; // seconds
        uint32 minSamples;
        uint32 distYes; // ppm, entry − L; 0 = no lower post (L = 0)
        uint32 distNo; // ppm, U − entry; 0 = no upper post (U = 100)
        uint32 lower; // ppm, set at the join, moved by extra lives
        uint32 upper;
        uint32 entry; // ppm, on the tick grid
        uint8 creatorSide;
        State state;
        bool knock; // the pending exit is a knock-out (no fee, ends the pot)
        uint8 exitSide;
        uint8 livesYes;
        uint8 livesNo;
        uint8 expiryTry;
        uint64 closeTime;
        uint64 deadline;
        uint64 expiry; // 0 for a normal pot
        uint64 cooldownUntil;
        uint64 nonce;
        uint64 requestTime;
        uint64 armedAt; // a knock-out window must start after the posts last moved
        address joiner; // the pending joiner while Joining, the taker (if any) while ExitRequested
        address joinerLeader; // the leader a pending joiner copies (0 = none)
        uint256 exitSize;
    }

    struct CreateParams {
        bytes32 conditionId;
        address resolver;
        uint8 side;
        uint256 size; // hundredths of a contract
        uint32 bandCenter;
        uint32 tolerance;
        uint32 distYes; // 0 = no lower post
        uint32 distNo; // 0 = no upper post
        uint64 expiry; // required for a short rope, 0 for a normal pot
        uint64 closeTime;
        uint64 grace;
        uint32 window;
        uint32 minSamples;
        uint256 copyOf; // token id of the side being copied, 0 = not a copy
    }

    /// @notice EIP-3009 authorization (Arc USDC receiveWithAuthorization); v = 0: transferFrom msg.sender.
    struct Authorization {
        address from;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 salt;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice A window average attested by the signer set (same layout as HonorCatPots, so the
    ///         MedianResolver works unchanged).
    struct WindowAttestation {
        uint256 potId;
        uint8 kind;
        uint64 nonce;
        uint64 windowStart;
        uint64 windowEnd;
        uint32 sampleCount;
        uint32 priceYes; // ppm
        bool valid;
        bytes32 evidenceHash;
    }

    /// @notice Depth, spread, category and trading close, attested by the signer set at creation.
    struct DepthAttestation {
        bytes32 conditionId;
        address account;
        uint64 contracts5c; // contracts within 5¢ of the mid on the thinner side, in hundredths
        uint32 spread; // ppm
        bool crypto; // crypto markets allow 10× leverage, others 5×
        uint64 closeTime;
        uint64 validUntil;
    }

    struct OutcomeAttestation {
        uint256 potId;
        bytes32 conditionId;
        uint8 outcome;
        bytes32 evidenceHash;
    }

    /// @notice Copy record of one token for one owner's tenure.
    struct Copy {
        address leader;
        uint256 paidIn; // deposit, maker treat, extra lives
        uint256 paidOut; // position cash paid out (gross)
        uint256 held; // 5% (rounded up) of every payout, held until the tenure ends
    }

    struct Levels {
        uint32 net;
        uint32 bowl;
        uint64 setAt;
    }

    bytes32 public constant WINDOW_TYPEHASH = keccak256(
        "Window(uint256 potId,uint8 kind,uint64 nonce,uint64 windowStart,uint64 windowEnd,uint32 sampleCount,uint32 priceYes,bool valid,bytes32 evidenceHash)"
    );
    bytes32 public constant DEPTH_TYPEHASH = keccak256(
        "Depth(bytes32 conditionId,address account,uint64 contracts5c,uint32 spread,bool crypto,uint64 closeTime,uint64 validUntil)"
    );
    bytes32 public constant OUTCOME_TYPEHASH = keccak256("Outcome(uint256 potId,bytes32 conditionId,uint8 outcome,bytes32 evidenceHash)");
    bytes32 public constant EXIT_REQUEST_TYPEHASH =
        keccak256("ExitRequest(uint256 potId,uint8 side,uint256 size,uint256 sigNonce,uint256 deadline)");
    bytes32 public constant HANDSHAKE_TYPEHASH =
        keccak256("Handshake(uint256 potId,uint32 priceYes,uint256 size,uint64 potNonce,uint256 deadline)");
    bytes32 public constant DEPOSIT_TAG = keccak256("HonorCatRopes.deposit");

    // ---------------------------------------------------------------- storage (shared layout)

    IERC20 public immutable usdc;
    uint256 public nextPotId = 1;
    bool public paused;
    uint256 public globalMaxPot = 25e6; // $25 on testnet: the most a pot can ever hold

    mapping(uint256 => Pot) internal _pots;
    mapping(uint256 => uint256) public sigNonce; // per token, for owner signatures
    mapping(uint256 => Levels) public levels; // per token
    mapping(uint256 => Copy) public copies; // per token
    mapping(uint256 => address) public tokenReferrer; // per token: who gets 20% of the fees it pays
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public potCount; // pots an account has entered (created or joined)
    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    // ---------------------------------------------------------------- events

    event PotCreated(
        uint256 indexed potId,
        address indexed creator,
        uint8 side,
        uint256 size,
        uint32 bandCenter,
        uint32 tolerance,
        uint32 distYes,
        uint32 distNo,
        uint64 expiry,
        uint256 escrow
    );
    event JoinRequested(uint256 indexed potId, address indexed joiner, uint64 nonce, uint64 requestTime, uint256 escrow);
    event Joined(uint256 indexed potId, uint32 entryPrice, uint32 lower, uint32 upper, uint256 depYes, uint256 depNo, bytes32 evidenceHash);
    event JoinFailed(uint256 indexed potId, uint64 nonce, bytes32 evidenceHash);
    event ExitRequested(uint256 indexed potId, uint8 side, uint256 size, uint64 nonce, uint64 requestTime);
    event KnockOutTriggered(uint256 indexed potId, uint8 knockedSide, uint32 priceYes, uint64 nonce, bytes32 evidenceHash);
    event ExitFailed(uint256 indexed potId, uint64 nonce, bytes32 evidenceHash);
    /// @dev reason: 0 exit, 1 knock-out, 2 expiry, 3 handshake.
    event PotDivided(uint256 indexed potId, uint8 reason, uint256 size, uint32 price, uint256 paidYes, uint256 paidNo, uint256 fee, bytes32 evidenceHash);
    event ExpiryWindowFailed(uint256 indexed potId, uint8 attempt, bytes32 evidenceHash);
    event ExtraLife(uint256 indexed potId, uint8 side, uint8 lives, uint32 lower, uint32 upper, uint256 paid);
    event Handshake(uint256 indexed potId, uint32 price, uint256 size);
    event TakeoverOffered(uint256 indexed potId, address indexed taker, uint64 nonce);
    event TakenOver(uint256 indexed potId, uint8 side, address indexed from, address indexed to, uint32 price, uint256 paidExiter, uint256 fee);
    event LevelsSet(uint256 indexed potId, uint8 side, uint32 net, uint32 bowl);
    event LevelTriggered(uint256 indexed potId, uint8 side, uint8 kind, uint32 priceYes, bytes32 evidenceHash);
    event PotSettled(uint256 indexed potId, uint8 outcome, uint256 paidYes, uint256 paidNo, bytes32 evidenceHash);
    event PotExpired(uint256 indexed potId, uint256 paidYes, uint256 paidNo);
    // Treats: every fee, who paid it and who received it (amounts net of any referral share)
    event ExitFee(uint256 indexed potId, address indexed payer, address indexed to, uint256 amount);
    event MakerTreat(uint256 indexed potId, address indexed payer, address indexed to, uint256 amount);
    event ReferralTreat(uint256 indexed potId, address indexed payer, address indexed referrer, uint256 amount);
    event CopycatTreat(uint256 indexed potId, address indexed payer, address indexed leader, uint256 amount, uint256 profit);
    event CopyMarked(uint256 indexed tokenId, address indexed leader, uint256 leaderToken);
    event ReferrerSet(address indexed account, address indexed referrer);
    event Paid(uint256 indexed potId, address indexed to, uint256 amount);
    event PaymentDeferred(uint256 indexed potId, address indexed to, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Paused(bool paused);
    event GlobalMaxPotSet(uint256 max);

    // ---------------------------------------------------------------- errors

    error PausedForNewPots();
    error BadParams();
    error WrongState();
    error NotOwner();
    error TooLate();
    error TooEarly();
    error InvalidAttestation();
    error Cooldown();
    error TransferMismatch();
    error AboveCap();
    error ExpiredSignature();
    error NothingToWithdraw();
    error NoMoreLives();
    error BadReferrer();
    error BadCopy();

    constructor(IERC20 usdc_, address owner_) ERC721("HonorCat rope side", "HCROPE") EIP712("HonorCatRopes", "1") Ownable(owner_) {
        usdc = usdc_;
    }

    // ---------------------------------------------------------------- the split rule (pure)

    /// @dev YES's share of `size` at `price` with posts [lower, upper]: (tick(clamp(price)) − tick(lower)) × size.
    function _yesShare(uint256 size, uint256 price, uint256 lower, uint256 upper) internal pure returns (uint256) {
        uint256 c = price < lower ? lower : (price > upper ? upper : price);
        return (c / TICK - lower / TICK) * size;
    }

    /// @dev The pot value of `size` between the posts.
    function _potValue(uint256 size, uint256 lower, uint256 upper) internal pure returns (uint256) {
        return (upper / TICK - lower / TICK) * size;
    }

    /// @dev floor(1%) of the pot value exited, so never more than 1%.
    function _exitFee(uint256 exited) internal pure returns (uint256) {
        return (exited * EXIT_FEE_BPS) / BPS;
    }

    function _makerTreat(uint256 deposit) internal pure returns (uint256) {
        return (deposit * MAKER_TREAT_BPS) / BPS;
    }

    function _tokenOf(uint256 potId, uint8 side) internal pure returns (uint256) {
        return potId * 2 + side;
    }

    function _total(Pot storage p) internal view returns (uint256) {
        return _potValue(p.size, p.lower, p.upper);
    }

    /// @dev New exits, knock-outs, joins and extra lives stop this long before the pot's end.
    function _lockout(Pot storage p) internal view returns (uint64) {
        uint64 l = DELAY + uint64(p.window) + 60;
        return l > MIN_LOCKOUT ? l : MIN_LOCKOUT;
    }

    /// @dev A short rope ends at its expiry, a normal pot at trading close.
    function _end(Pot storage p) internal view returns (uint64) {
        return p.expiry != 0 ? p.expiry : p.closeTime;
    }

    function _beforeLockout(Pot storage p) internal view {
        if (block.timestamp + _lockout(p) >= _end(p)) revert TooLate();
    }

    function _expiryStart(Pot storage p, uint8 attempt) internal view returns (uint64) {
        return p.expiry + DELAY + uint64(attempt) * (uint64(p.window) + 60);
    }

    function _windowDigest(WindowAttestation calldata a) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(WINDOW_TYPEHASH, a.potId, a.kind, a.nonce, a.windowStart, a.windowEnd, a.sampleCount, a.priceYes, a.valid, a.evidenceHash))
        );
    }

    function _handshakeDigest(uint256 potId, uint32 priceYes, uint256 size, uint256 deadline) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(HANDSHAKE_TYPEHASH, potId, priceYes, size, _pots[potId].nonce, deadline)));
    }

    function _exitRequestDigest(uint256 potId, uint8 side, uint256 size, uint256 deadline) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(EXIT_REQUEST_TYPEHASH, potId, side, size, sigNonce[_tokenOf(potId, side)], deadline)));
    }

    // ---------------------------------------------------------------- shared state changes

    function _requestExit(uint256 potId, uint8 side, uint256 size) internal {
        Pot storage p = _pots[potId];
        if (p.state != State.Live) revert WrongState();
        if (side > NO || size == 0 || size > p.size) revert BadParams();
        _beforeLockout(p);
        if (block.timestamp < p.cooldownUntil) revert Cooldown();
        p.exitSide = side;
        p.exitSize = size;
        p.knock = false;
        p.requestTime = uint64(block.timestamp);
        p.nonce += 1;
        p.state = State.ExitRequested;
        emit ExitRequested(potId, side, size, p.nonce, p.requestTime);
    }

    function _exitFailed(uint256 potId, Pot storage p, bytes32 evidenceHash) internal {
        p.state = State.Live;
        p.knock = false;
        p.cooldownUntil = uint64(block.timestamp) + COOLDOWN;
        emit ExitFailed(potId, p.nonce, evidenceHash);
        _refundTaker(potId, p);
    }

    /// @dev Returns a taker's escrow (the whole pot value) when its takeover does not complete.
    function _refundTaker(uint256 potId, Pot storage p) internal {
        address taker = p.joiner;
        if (taker == address(0)) return;
        p.joiner = address(0);
        _pay(potId, taker, _total(p));
    }

    function _refundEscrowsAndExpire(uint256 potId, Pot storage p) internal {
        uint8 cs = p.creatorSide;
        uint256 r = cs == YES ? p.escrowYes : p.escrowNo;
        p.escrowYes = 0;
        p.escrowNo = 0;
        p.size = 0;
        p.state = State.Expired;
        delete copies[_tokenOf(potId, cs)]; // nothing was paid out under the copy
        address creator = ownerOf(_tokenOf(potId, cs));
        emit PotExpired(potId, cs == YES ? r : 0, cs == NO ? r : 0);
        _pay(potId, creator, r);
    }

    /// @dev Pure arithmetic of a division: payYes + payNo = pot value of `size`; fee ≤ 1% of it and
    ///      ≤ the exiter's cash.
    function _divideMath(uint8 exitSide, uint256 size, uint32 price, bool withFee, uint256 lower, uint256 upper)
        internal
        pure
        returns (uint256 payYes, uint256 payNo, uint256 fee)
    {
        uint256 total = _potValue(size, lower, upper);
        uint256 cashYes = _yesShare(size, price, lower, upper);
        uint256 cashNo = total - cashYes;
        if (withFee) {
            fee = _exitFee(total);
            uint256 cashExit = exitSide == YES ? cashYes : cashNo;
            if (fee > cashExit) fee = cashExit;
        }
        payYes = exitSide == YES ? cashYes - fee : cashYes + fee;
        payNo = exitSide == YES ? cashNo + fee : cashNo - fee;
    }

    /// @dev Divides `size` of the pot at `price` (clamped to the posts). With `withFee` the exiter pays the
    ///      exit fee to the other side (20% of it to the exiter's referrer, if any).
    function _divide(uint256 potId, Pot storage p, uint8 exitSide, uint256 size, uint32 price, bool withFee, uint8 reason, bytes32 evidenceHash)
        internal
    {
        (uint256 payYes, uint256 payNo, uint256 fee) = _divideMath(exitSide, size, price, withFee, p.lower, p.upper);
        p.size -= size;
        bool done = p.size == 0;
        p.state = done ? State.Divided : State.Live;
        emit PotDivided(potId, reason, size, price, payYes, payNo, fee, evidenceHash);
        uint256 exitToken = _tokenOf(potId, exitSide);
        uint256 otherToken = _tokenOf(potId, 1 - exitSide);
        address exiter = ownerOf(exitToken);
        address other = ownerOf(otherToken);
        (uint256 payExit, uint256 payOther) = exitSide == YES ? (payYes, payNo) : (payNo, payYes);
        _payPosition(potId, exitToken, exiter, payExit);
        _payPosition(potId, otherToken, other, payOther - fee);
        _payFee(potId, exitToken, exiter, other, fee, 0);
        if (done) _endPot(potId);
    }

    /// @dev Pays a position's cash. For a copy, 5% (rounded up) is held back until the tenure ends.
    function _payPosition(uint256 potId, uint256 tokenId, address to, uint256 amount) internal {
        Copy storage c = copies[tokenId];
        if (c.leader != address(0) && amount > 0) {
            uint256 h = (amount * COPYCAT_BPS + BPS - 1) / BPS;
            c.paidOut += amount;
            c.held += h;
            amount -= h;
        }
        _pay(potId, to, amount);
    }

    /// @dev Ends a copy tenure: the leader gets 5% of the profit (paid out minus paid in), if there is one,
    ///      out of the hold-back, which always covers it (held ≥ 5% of paidOut ≥ 5% of the profit); the
    ///      rest of the hold-back goes back to `owner_`.
    function _finishCopy(uint256 potId, uint256 tokenId, address owner_) internal {
        Copy memory c = copies[tokenId];
        if (c.leader == address(0)) return;
        delete copies[tokenId];
        uint256 profit = c.paidOut > c.paidIn ? c.paidOut - c.paidIn : 0;
        uint256 treat = (profit * COPYCAT_BPS) / BPS;
        if (treat > 0) {
            emit CopycatTreat(potId, owner_, c.leader, treat, profit);
            _payFee(potId, tokenId, owner_, c.leader, treat, 2);
        }
        _pay(potId, owner_, c.held - treat);
    }

    function _endPot(uint256 potId) internal {
        uint256 y = _tokenOf(potId, YES);
        uint256 n = _tokenOf(potId, NO);
        _finishCopy(potId, y, _ownerOf(y));
        _finishCopy(potId, n, _ownerOf(n));
    }

    /// @dev A fee of `amount` from `payer` (holding `tokenId`) to `to`; 20% (rounded down) to the token's
    ///      referrer if it has one, the rest to `to`. kind: 0 exit fee, 1 maker treat, 2 copycat treat.
    function _payFee(uint256 potId, uint256 tokenId, address payer, address to, uint256 amount, uint8 kind) internal {
        if (amount == 0) return;
        address ref = tokenReferrer[tokenId];
        uint256 share = ref == address(0) ? 0 : (amount * REFERRAL_SHARE_BPS) / BPS;
        if (share > 0) {
            emit ReferralTreat(potId, payer, ref, share);
            _pay(potId, ref, share);
        }
        if (kind == 0) emit ExitFee(potId, payer, to, amount - share);
        else if (kind == 1) emit MakerTreat(potId, payer, to, amount - share);
        _pay(potId, to, amount - share);
    }

    function _checkWindow(Pot storage p, WindowAttestation calldata a, uint8 kind, bytes calldata sigs) internal view {
        if (a.kind != kind || a.nonce != p.nonce) revert InvalidAttestation();
        if (a.windowStart != p.requestTime + DELAY || a.windowEnd != a.windowStart + p.window) revert InvalidAttestation();
        if (a.windowEnd > block.timestamp) revert TooEarly();
        if (a.priceYes > P) revert InvalidAttestation();
        if (a.valid && a.sampleCount < p.minSamples) revert InvalidAttestation();
        if (!SignatureChecker.isValidERC1271SignatureNow(p.resolver, _windowDigest(a), sigs)) revert InvalidAttestation();
    }

    function _payer(Authorization calldata auth) internal view returns (address) {
        return auth.v == 0 ? msg.sender : auth.from;
    }

    /// @dev Pulls `amount` from `from`: EIP-3009 authorization with a nonce bound to this action, or
    ///      transferFrom from msg.sender.
    function _pull(address from, uint256 amount, bytes32 action, Authorization calldata auth) internal {
        if (amount == 0) return;
        uint256 before = usdc.balanceOf(address(this));
        if (auth.v == 0) {
            usdc.safeTransferFrom(msg.sender, address(this), amount);
        } else {
            bytes32 nonce = keccak256(abi.encode(DEPOSIT_TAG, block.chainid, address(this), action, auth.salt));
            IERC3009(address(usdc)).receiveWithAuthorization(from, address(this), amount, auth.validAfter, auth.validBefore, nonce, auth.v, auth.r, auth.s);
        }
        if (usdc.balanceOf(address(this)) != before + amount) revert TransferMismatch();
    }

    /// @dev Never reverts on a failed transfer: the amount becomes claimable instead.
    function _pay(uint256 potId, address to, uint256 amount) internal {
        if (amount == 0) return;
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

    /// @dev Positions move freely, except the exiting side's token while its own exit window is open. A
    ///      transfer ends the sender's copy tenure and clears its levels and referral share.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            uint256 potId = tokenId / 2;
            Pot storage p = _pots[potId];
            if (p.state == State.ExitRequested && !p.knock && p.exitSide == uint8(tokenId % 2)) revert WrongState();
            delete levels[tokenId];
            delete tokenReferrer[tokenId];
            _finishCopy(potId, tokenId, from);
        }
        return super._update(to, tokenId, auth);
    }
}
