// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {HonorCatRopes} from "./HonorCatRopes.sol";
import {HonorCatRopesExtension} from "./ropes/HonorCatRopesExtension.sol";
import {HonorCatRopesExtra} from "./ropes/HonorCatRopesExtra.sol";
import {RopesBase} from "./ropes/RopesBase.sol";

/// @title  HonorCatPerps
/// @notice A perp is a chain of short ropes on HonorCatRopes that renews itself. Two players each keep a
///         budget here; every rope takes the same stake S from each (both posts d points from the entry,
///         so YES and NO put in the same S); "lives" are whole stakes in a player's free balance.
///         This contract holds both sides of the current rope and receives both payouts. When a rope ends
///         by knock-out or expiry, anyone may call `advance`: it credits the payouts and, if both players
///         still renew and can pay S and the market can carry another rope, opens the next rope at the
///         division price in the same transaction; otherwise the chain ends. Players can stop renewing,
///         leave now (an exit priced like any other, paying the exit fee to the other side), agree a
///         handshake, add lives and withdraw their free balance at any time. No debt, no margin call:
///         every rope is fully funded by the two stakes. Nothing goes to the operator.
/// @dev    Design: docs/perp-design.md and the owner's spec of 2026-11-18. One contract for all perps.
contract HonorCatPerps is ReentrancyGuard, IERC1271 {
    using SafeERC20 for IERC20;

    uint256 public constant TICK = 100;
    uint256 public constant P = 1_000_000;
    uint256 public constant BPS = 10_000;
    uint64 public constant EXPIRY_LEAD = 2 hours;
    uint64 public constant MIN_LIFE = 10 minutes;
    uint8 internal constant YES = 0;
    uint8 internal constant NO = 1;
    bytes4 internal constant MAGIC = 0x1626ba7e;

    enum Phase {
        None,
        Open, // the creator waits for a second player
        Funded, // both players in, no rope running (before the first rope, or after a failed first join)
        Joining, // the first rope's join window is being priced
        Running, // a rope is live (or being divided)
        Ended
    }

    struct Terms {
        bytes32 conditionId;
        address resolver;
        uint8 creatorSide; // YES or NO
        uint32 d; // rope length, ppm (both posts d from the entry)
        uint256 size; // hundredths of a contract per rope
        uint64 ropeLife; // seconds each rope may run at most
        uint64 closeTime;
        uint64 grace;
        uint32 window;
        uint32 minSamples;
        uint32 tolerance; // the first rope's join band, ppm
    }

    struct Perp {
        Terms t;
        address a; // creator
        address b; // joiner
        Phase phase;
        bool renewA;
        bool renewB;
        bool leaving; // a player asked to leave now: the chain ends after this rope
        uint256 pot; // the current rope (0 = none)
        uint256 freeA;
        uint256 freeB;
        int256 resultA; // what A has won (+) or lost (−) so far
        int256 resultB;
        uint32 ropes; // ropes started
        uint256 treat; // the first rope's maker treat, held until its join is priced
    }

    IERC20 public immutable usdc;
    HonorCatRopes public immutable ropes;
    HonorCatRopesExtension internal immutable ext;
    HonorCatRopesExtra internal immutable extra;

    uint256 public nextPerpId = 1;
    mapping(uint256 => Perp) internal _perps;
    mapping(uint256 => uint256) public perpOfPot; // rope pot id -> perp id
    /// @notice Handshake approvals: digest -> player -> approved.
    mapping(bytes32 => mapping(address => bool)) public approved;

    event PerpOpened(uint256 indexed perpId, address indexed creator, uint8 side, uint32 d, uint256 size, uint256 budget);
    event PerpJoined(uint256 indexed perpId, address indexed joiner, uint256 budget);
    event RopeStarted(uint256 indexed perpId, uint256 indexed potId, uint32 rope, bool rolled);
    event RopeCredited(uint256 indexed perpId, uint256 indexed potId, uint8 reason, uint256 paidA, uint256 paidB);
    event PerpEnded(uint256 indexed perpId, string why);
    event RenewalOff(uint256 indexed perpId, address indexed player);
    event LeaveRequested(uint256 indexed perpId, address indexed player);
    event HandshakeApproved(uint256 indexed perpId, address indexed player, uint32 priceYes);
    event LivesAdded(uint256 indexed perpId, address indexed player, uint256 amount);
    event Withdrawn(uint256 indexed perpId, address indexed player, uint256 amount);

    error BadParams();
    error WrongPhase();
    error NotPlayer();
    error TooLittle();

    constructor(HonorCatRopes ropes_) {
        ropes = ropes_;
        ext = HonorCatRopesExtension(address(ropes_));
        extra = HonorCatRopesExtra(address(ropes_));
        usdc = ropes_.usdc();
        usdc.forceApprove(address(ropes_), type(uint256).max);
    }

    // ---------------------------------------------------------------- views

    function perp(uint256 perpId) external view returns (Perp memory) {
        return _perps[perpId];
    }

    /// @notice The stake each side puts into every rope: d (in ticks) × size, in USDC base units.
    function stake(uint256 perpId) public view returns (uint256) {
        Terms storage t = _perps[perpId].t;
        return (uint256(t.d) / TICK) * t.size;
    }

    /// @notice Whole stakes in each player's free balance.
    function lives(uint256 perpId) external view returns (uint256 livesA, uint256 livesB) {
        Perp storage q = _perps[perpId];
        uint256 s = stake(perpId);
        return (q.freeA / s, q.freeB / s);
    }

    // ---------------------------------------------------------------- open, join, first rope

    /// @notice Opens a perp: the creator's side, the rope length d (from the leverage), the size per rope,
    ///         the rope life and a budget of at least one stake (more = more lives).
    function open(Terms calldata t, uint256 budget) external nonReentrant returns (uint256 perpId) {
        if (t.creatorSide > NO || t.d == 0 || t.d % TICK != 0 || t.size == 0 || t.ropeLife < MIN_LIFE || t.resolver == address(0)) revert BadParams();
        perpId = nextPerpId++;
        Perp storage q = _perps[perpId];
        q.t = t;
        if (budget < stake(perpId)) revert TooLittle();
        q.a = msg.sender;
        q.phase = Phase.Open;
        q.renewA = true;
        q.renewB = true;
        q.freeA = budget;
        usdc.safeTransferFrom(msg.sender, address(this), budget);
        emit PerpOpened(perpId, msg.sender, t.creatorSide, t.d, t.size, budget);
    }

    /// @notice Joins as the other side with a budget of at least one stake.
    function join(uint256 perpId, uint256 budget) external nonReentrant {
        Perp storage q = _perps[perpId];
        if (q.phase != Phase.Open) revert WrongPhase();
        if (msg.sender == q.a) revert NotPlayer();
        if (budget < stake(perpId) + _treat(stake(perpId))) revert TooLittle();
        q.b = msg.sender;
        q.freeB = budget;
        q.phase = Phase.Funded;
        usdc.safeTransferFrom(msg.sender, address(this), budget);
        emit PerpJoined(perpId, msg.sender, budget);
    }

    /// @notice Starts the first rope around `center` through the pot contract's join window (both sides
    ///         paid from the budgets; the joiner pays the maker treat to the creator). Either player, or
    ///         anyone on their behalf, with the samplers' depth attestation for this contract.
    function startFirstRope(uint256 perpId, uint32 center, RopesBase.DepthAttestation calldata d, bytes calldata sigs) external nonReentrant {
        Perp storage q = _perps[perpId];
        if (q.phase != Phase.Funded || q.ropes != 0) revert WrongPhase();
        uint256 s = stake(perpId);
        uint256 treat = _treat(s);
        if (q.freeA < s || q.freeB < s + treat) revert TooLittle();
        RopesBase.CreateParams memory c = _params(q, center, q.t.tolerance);
        RopesBase.Authorization memory none;
        q.freeA -= s;
        q.freeB -= s + treat;
        q.treat = treat;
        uint256 pot = ropes.create(c, d, sigs, none);
        ropes.requestJoin(pot, 0, none);
        q.pot = pot;
        perpOfPot[pot] = perpId;
        q.phase = Phase.Joining;
    }

    // ---------------------------------------------------------------- advance: credit, roll or end

    /// @notice Moves a perp on after its rope changed state; anyone may call it. A priced first rope
    ///         becomes Running. A failed first join returns both stakes (the perp is Funded again). A rope
    ///         that ended is credited from the pot contract's division record and, after a knock-out or an
    ///         expiry, the next rope opens at the division price in the same transaction if both players
    ///         renew, both can pay a stake and the market can carry it; otherwise the chain ends.
    function advance(uint256 perpId, RopesBase.DepthAttestation calldata d, bytes calldata sigs) external nonReentrant {
        Perp storage q = _perps[perpId];
        uint256 pot = q.pot;
        if (pot == 0 || (q.phase != Phase.Joining && q.phase != Phase.Running)) revert WrongPhase();
        RopesBase.Pot memory p = ropes.pot(pot);
        uint256 s = stake(perpId);

        if (q.phase == Phase.Joining) {
            if (p.state == RopesBase.State.Live) {
                // The first rope is priced: the maker treat came back to this contract; it is the creator's.
                q.freeA += q.treat;
                q.resultA += int256(q.treat);
                q.resultB -= int256(q.treat);
                q.treat = 0;
                q.phase = Phase.Running;
                q.ropes = 1;
                emit RopeStarted(perpId, pot, 1, false);
                return;
            }
            if (p.state == RopesBase.State.Open) {
                // The join was not priced (no agreed price inside the band): its escrow came back; take
                // back the offer too, and both stakes are free again.
                ext.cancel(pot);
                q.freeA += s;
                q.freeB += s + q.treat;
                q.treat = 0;
                q.pot = 0;
                q.phase = Phase.Funded;
                return;
            }
            revert WrongPhase();
        }

        if (p.state == RopesBase.State.Live || p.state == RopesBase.State.ExitRequested || p.state == RopesBase.State.Joining) revert WrongPhase();
        // The rope ended (divided, settled or deposits back): credit both payouts.
        (uint32 price, uint8 reason,, uint128 paidYes, uint128 paidNo) = ropes.divisions(pot);
        (uint256 paidA, uint256 paidB) = q.t.creatorSide == YES ? (uint256(paidYes), uint256(paidNo)) : (uint256(paidNo), uint256(paidYes));
        q.freeA += paidA;
        q.freeB += paidB;
        q.resultA += int256(paidA) - int256(s);
        q.resultB += int256(paidB) - int256(s);
        q.pot = 0;
        emit RopeCredited(perpId, pot, reason, paidA, paidB);

        bool renewable = reason == 1 || reason == 2; // knock-out or expiry
        if (!renewable || q.leaving) return _end(q, perpId, reason == 0 ? "a player left" : reason == 3 ? "handshake" : "the market settled");
        if (!q.renewA || !q.renewB) return _end(q, perpId, "renewal switched off");
        if (q.freeA < s || q.freeB < s) return _end(q, perpId, "a player ran out of lives");
        // Anyone may call this, so a bad depth attestation must not end the chain: it reverts instead.
        if (
            d.account != address(this) || d.conditionId != q.t.conditionId || d.closeTime != q.t.closeTime || block.timestamp > d.validUntil
                || !SignatureChecker.isValidERC1271SignatureNow(q.t.resolver, ropes.depthDigest(d), sigs)
        ) revert BadParams();
        // The next rope: same d and size, entry at the division price, as long as the rope life allows.
        RopesBase.CreateParams memory c = _params(q, uint32((uint256(price) / TICK) * TICK), 0);
        q.freeA -= s;
        q.freeB -= s;
        try extra.openFunded(c, pot, d, sigs) returns (uint256 next) {
            q.pot = next;
            perpOfPot[next] = perpId;
            q.ropes += 1;
            emit RopeStarted(perpId, next, q.ropes, true);
        } catch {
            q.freeA += s;
            q.freeB += s;
            _end(q, perpId, "the market cannot carry another rope");
        }
    }

    // ---------------------------------------------------------------- the players' controls

    /// @notice Stops renewing: the current rope runs to its end and nothing new opens.
    function stopRenewing(uint256 perpId) external {
        Perp storage q = _perps[perpId];
        if (msg.sender == q.a) q.renewA = false;
        else if (msg.sender == q.b) q.renewB = false;
        else revert NotPlayer();
        emit RenewalOff(perpId, msg.sender);
    }

    /// @notice Leaves now: the current rope is exited at fair value, priced over the window after this
    ///         request, and the leaving player pays the exit fee to the other side. The chain then ends.
    function leaveNow(uint256 perpId) external nonReentrant {
        Perp storage q = _perps[perpId];
        if (q.phase != Phase.Running || q.pot == 0) revert WrongPhase();
        uint8 side = _sideOf(q, msg.sender);
        q.leaving = true;
        ext.requestExit(q.pot, side, ropes.pot(q.pot).size);
        emit LeaveRequested(perpId, msg.sender);
    }

    /// @notice Approves a handshake: the current rope divided at `priceYes` without a fee, then the chain
    ///         ends. Once both players approved the same terms, it is carried out at once.
    function agreeHandshake(uint256 perpId, uint32 priceYes, uint256 deadline) external nonReentrant {
        Perp storage q = _perps[perpId];
        if (q.phase != Phase.Running || q.pot == 0) revert WrongPhase();
        _sideOf(q, msg.sender);
        uint256 size = ropes.pot(q.pot).size;
        bytes32 digest = extra.handshakeDigest(q.pot, priceYes, size, deadline);
        approved[digest][msg.sender] = true;
        emit HandshakeApproved(perpId, msg.sender, priceYes);
        if (approved[digest][q.a] && approved[digest][q.b]) {
            q.leaving = true;
            bytes memory sig = abi.encode(perpId);
            ext.handshake(q.pot, priceYes, size, deadline, sig, sig);
        }
    }

    /// @notice ERC-1271: this contract signs a rope's handshake only when both of the perp's players approved it.
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        if (signature.length != 32) return 0xffffffff;
        Perp storage q = _perps[abi.decode(signature, (uint256))];
        return q.a != address(0) && approved[digest][q.a] && approved[digest][q.b] ? MAGIC : bytes4(0xffffffff);
    }

    /// @notice Adds lives: more budget for the caller's side.
    function addLives(uint256 perpId, uint256 amount) external nonReentrant {
        Perp storage q = _perps[perpId];
        if (q.phase == Phase.None || q.phase == Phase.Ended) revert WrongPhase();
        if (msg.sender == q.a) q.freeA += amount;
        else if (msg.sender == q.b) q.freeB += amount;
        else revert NotPlayer();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit LivesAdded(perpId, msg.sender, amount);
    }

    /// @notice Withdraws free balance (anything not in the current rope). Before anyone joined, the creator
    ///         may withdraw everything, which closes the offer.
    function withdraw(uint256 perpId, uint256 amount) external nonReentrant {
        Perp storage q = _perps[perpId];
        if (msg.sender == q.a) {
            if (amount > q.freeA) revert TooLittle();
            q.freeA -= amount;
            if (q.phase == Phase.Open && q.freeA < stake(perpId)) {
                q.phase = Phase.Ended;
                emit PerpEnded(perpId, "offer withdrawn");
            }
        } else if (msg.sender == q.b) {
            if (amount > q.freeB) revert TooLittle();
            q.freeB -= amount;
        } else revert NotPlayer();
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(perpId, msg.sender, amount);
    }

    // ---------------------------------------------------------------- internals

    function _end(Perp storage q, uint256 perpId, string memory why) internal {
        q.phase = Phase.Ended;
        emit PerpEnded(perpId, why);
    }

    function _sideOf(Perp storage q, address who) internal view returns (uint8) {
        if (who == q.a) return q.t.creatorSide;
        if (who == q.b) return 1 - q.t.creatorSide;
        revert NotPlayer();
    }

    function _treat(uint256 s) internal view returns (uint256) {
        return (s * ropes.MAKER_TREAT_BPS()) / BPS;
    }

    /// @dev The pot contract's terms for the next rope: posts d either side, the rope life capped by the
    ///      expiry rule (2 hours before close).
    function _params(Perp storage q, uint32 center, uint32 tol) internal view returns (RopesBase.CreateParams memory c) {
        Terms storage t = q.t;
        uint64 latest = t.closeTime - EXPIRY_LEAD;
        uint64 expiry = uint64(block.timestamp) + t.ropeLife;
        if (expiry > latest) expiry = latest;
        c = RopesBase.CreateParams({
            conditionId: t.conditionId,
            resolver: t.resolver,
            side: t.creatorSide,
            size: t.size,
            bandCenter: center,
            tolerance: tol,
            distYes: t.d,
            distNo: t.d,
            expiry: expiry,
            closeTime: t.closeTime,
            grace: t.grace,
            window: t.window,
            minSamples: t.minSamples,
            copyOf: 0
        });
    }
}
