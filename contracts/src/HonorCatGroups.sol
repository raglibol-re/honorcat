// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HonorCatGroups
/// @notice Group pots: two teams on opposite sides of one Gemini market, anyone joins either team
///         with any amount (docs/groups.md). Joins and leaves are cleared in 60-second batches at the
///         price of the 30-second window after each batch, attested by the samplers through a
///         MedianResolver bound to this contract (same Window, Depth and Outcome layouts as the pot
///         contracts). Normal pots only: posts at 0 and 100, no leverage. No operator, no fee to
///         anyone but the players; rounding dust stays in the contract.
/// @dev No function loops over members. Each team keeps Liquity's product-sum accumulators (P, S,
///      scale, epoch) for pro-rata shrinking and payouts; waiting joins keep a product of their
///      unfilled fraction. A member's claim walks only the batches of their own request (at most
///      MAX_WAIT + 1).
contract HonorCatGroups is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants

    uint256 public constant PPM = 1_000_000;
    uint256 internal constant ONE = 1e18;
    uint256 internal constant SCALE_FACTOR = 1e9;
    uint64 public constant PERIOD = 60; // seconds of one batch
    uint8 public constant KIND_BATCH = 20; // window attestation kind of a group batch
    uint64 public constant ATTEST_TIMEOUT = 600; // a batch with no attestation by then fails
    uint64 public constant MAX_WAIT = 20; // batches a waiting join may wait after its own
    uint256 public constant EXIT_FEE_BPS = 100; // 1% of the value exited, to the other team
    uint256 public constant MIN_PRICE = 10_000; // a batch clears only between 1% and 99%
    uint256 public constant MAX_PRICE = 990_000;
    uint256 public constant MIN_JOIN = 100_000; // $0.10
    uint256 public constant CAP_PER_CENTI = 2_500; // like the pots: 0.25 USDC per contract in depth
    uint256 public constant MAX_NOTIONAL = 100_000_000; // testnet limit per team: $100
    uint64 public constant MAX_GRACE = 30 days;
    uint64 internal constant NONE = type(uint64).max;

    uint8 public constant YES = 0;
    uint8 public constant NO = 1;

    bytes32 public constant WINDOW_TYPEHASH = keccak256(
        "Window(uint256 potId,uint8 kind,uint64 nonce,uint64 windowStart,uint64 windowEnd,uint32 sampleCount,uint32 priceYes,bool valid,bytes32 evidenceHash)"
    );
    bytes32 public constant DEPTH_TYPEHASH = keccak256(
        "Depth(bytes32 conditionId,address account,uint64 contracts5c,uint32 spread,bool crypto,uint64 closeTime,uint64 validUntil)"
    );
    bytes32 public constant OUTCOME_TYPEHASH = keccak256("Outcome(uint256 potId,bytes32 conditionId,uint8 outcome,bytes32 evidenceHash)");

    // ---------------------------------------------------------------- types

    struct WindowAttestation {
        uint256 potId;
        uint8 kind;
        uint64 nonce;
        uint64 windowStart;
        uint64 windowEnd;
        uint32 sampleCount;
        uint32 priceYes;
        bool valid;
        bytes32 evidenceHash;
    }

    struct DepthAttestation {
        bytes32 conditionId;
        address account;
        uint64 contracts5c;
        uint32 spread;
        bool crypto;
        uint64 closeTime;
        uint64 validUntil;
    }

    struct OutcomeAttestation {
        uint256 potId;
        bytes32 conditionId;
        uint8 outcome; // 1 YES, 0 NO, 2 void
        bytes32 evidenceHash;
    }

    enum State {
        None,
        Open,
        Settled,
        Void
    }

    struct Group {
        bytes32 conditionId;
        address resolver;
        address creator;
        uint64 createdAt;
        uint64 closeTime;
        uint64 deadline;
        uint32 window;
        uint32 minSamples;
        State state;
        uint8 outcome;
        uint64 nextBatch; // the batch to clear next, or NONE
        uint256 cap; // most notional per team
        uint256 balance; // this group's USDC in the contract (never below what it owes)
    }

    /// @dev A team's pool and accumulators.
    struct Team {
        uint256 pool; // notional in positions (leaves being priced are outside)
        uint256 exiting; // notional of leaves waiting for their batch
        uint256 P; // running product (1e18), shrinks with each pro-rata shrink
        uint128 scale;
        uint128 epoch;
        int256 deposits; // what members put in less what they were paid (for a void)
        // waiting joins
        uint256 Q; // running product of the unfilled fraction (1e18)
        uint256 carryBase; // sum of waiting joins' bases (escrow / Q at entry)
        uint64 joinEpoch;
    }

    /// @dev Accumulator snapshot: where new notional entered a team.
    struct Snap {
        uint256 P;
        uint256 S;
        uint128 scale;
        uint128 epoch;
    }

    /// @dev What a batch held and how it cleared, per team.
    struct BatchTeam {
        uint256 newJoin; // escrow of joins made in this batch
        uint256 newWait; // of which joins that wait
        uint256 exits; // notional leaving in this batch
        uint256 phi; // fraction of the available join escrow filled (1e18)
        uint256 nfrac; // notional granted per unit of notional the available escrow could buy (1e18, rounded down)
        uint256 qBefore; // the team's Q when the batch cleared (before) and after
        uint256 qAfter;
        uint64 jeBefore;
        uint64 jeAfter;
        Snap snap; // where this batch's new notional entered (after the shrink)
    }

    struct Batch {
        bool done;
        bool failed;
        uint32 price; // YES, ppm
    }

    struct Request {
        uint64 batch; // the batch it was made in
        uint8 team;
        bool wait;
        bool active;
        uint256 escrow;
        // claim progress
        uint64 next; // next batch to claim from (after the first)
        uint256 base; // waiting base (in the join epoch below)
        uint64 joinEpoch;
    }

    struct Position {
        bool active;
        uint8 team;
        uint256 n0; // notional at the snapshot
        Snap snap;
    }

    struct Exit {
        bool active;
        uint64 batch;
        uint256 x;
    }

    // ---------------------------------------------------------------- storage

    IERC20 public immutable usdc;
    uint256 public groupCount;
    mapping(uint256 => Group) internal _groups;
    mapping(uint256 => mapping(uint8 => Team)) internal _teams;
    mapping(uint256 => mapping(uint8 => mapping(uint128 => mapping(uint128 => uint256)))) internal _sums; // epoch -> scale -> S
    mapping(uint256 => mapping(uint8 => mapping(uint64 => mapping(uint64 => uint256)))) internal _expBase; // joinEpoch -> batch -> base expiring
    mapping(uint256 => mapping(uint64 => Batch)) public batches;
    mapping(uint256 => mapping(uint64 => mapping(uint8 => BatchTeam))) internal _bt;
    mapping(uint256 => uint64[]) internal _active; // batches with joins or leaves, in order
    mapping(uint256 => uint256) internal _activeHead;
    mapping(uint256 => mapping(address => Request)) public requests;
    mapping(uint256 => mapping(address => Position)) internal _positions;
    mapping(uint256 => mapping(address => Exit)) public exits;
    mapping(uint256 => mapping(address => uint256)) public claimable;

    // ---------------------------------------------------------------- events

    event GroupCreated(uint256 indexed groupId, address indexed creator, bytes32 conditionId, uint64 closeTime, uint256 cap, string yesName, string noName);
    event JoinRequested(uint256 indexed groupId, address indexed account, uint8 team, uint256 amount, bool wait, uint64 batch);
    event LeaveRequested(uint256 indexed groupId, address indexed account, uint8 team, uint256 notional, uint64 batch);
    event BatchCleared(
        uint256 indexed groupId,
        uint64 indexed batch,
        uint32 price,
        uint256 matched,
        uint256 takeoverYes,
        uint256 takeoverNo,
        uint256 cancelled,
        uint256 shrinkYes,
        uint256 shrinkNo
    );
    event BatchFailed(uint256 indexed groupId, uint64 indexed batch);
    event Claimed(uint256 indexed groupId, address indexed account, uint256 amount);
    event Withdrawn(uint256 indexed groupId, address indexed account, uint256 amount);
    event PositionTransferred(uint256 indexed groupId, address indexed from, address indexed to);
    event GroupSettled(uint256 indexed groupId, uint8 outcome, bytes32 evidenceHash);
    event GroupVoided(uint256 indexed groupId);

    // ---------------------------------------------------------------- errors

    error WrongState();
    error BadParams();
    error InvalidAttestation();
    error TooEarly();
    error TooLate();
    error Busy();
    error NothingToDo();

    constructor(IERC20 usdc_) EIP712("HonorCatGroups", "1") {
        usdc = usdc_;
    }

    // ---------------------------------------------------------------- digests (the resolver checks these)

    function windowDigest(WindowAttestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(WINDOW_TYPEHASH, a.potId, a.kind, a.nonce, a.windowStart, a.windowEnd, a.sampleCount, a.priceYes, a.valid, a.evidenceHash))
        );
    }

    function depthDigest(DepthAttestation calldata d) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(DEPTH_TYPEHASH, d.conditionId, d.account, d.contracts5c, d.spread, d.crypto, d.closeTime, d.validUntil)));
    }

    function outcomeDigest(OutcomeAttestation calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(OUTCOME_TYPEHASH, o.potId, o.conditionId, o.outcome, o.evidenceHash)));
    }

    // ---------------------------------------------------------------- create

    /// @notice Opens a group on a market. The depth attestation (signed for this contract and the
    ///         creator) sets the cap and the trading close.
    function create(
        address resolver,
        DepthAttestation calldata d,
        bytes calldata sigs,
        uint64 graceSeconds,
        uint32 window,
        uint32 minSamples,
        string calldata yesName,
        string calldata noName
    ) external returns (uint256 groupId) {
        if (d.account != msg.sender || block.timestamp > d.validUntil || d.closeTime <= block.timestamp + PERIOD + window + 120) revert BadParams();
        if (graceSeconds == 0 || graceSeconds > MAX_GRACE || window == 0 || window > PERIOD || minSamples == 0) revert BadParams();
        if (bytes(yesName).length == 0 || bytes(yesName).length > 40 || bytes(noName).length == 0 || bytes(noName).length > 40) revert BadParams();
        if (!SignatureChecker.isValidERC1271SignatureNow(resolver, depthDigest(d), sigs)) revert InvalidAttestation();
        groupId = ++groupCount;
        uint256 cap = uint256(d.contracts5c) * CAP_PER_CENTI;
        Group storage g = _groups[groupId];
        g.conditionId = d.conditionId;
        g.resolver = resolver;
        g.creator = msg.sender;
        g.createdAt = uint64(block.timestamp);
        g.closeTime = d.closeTime;
        g.deadline = d.closeTime + graceSeconds;
        g.window = window;
        g.minSamples = minSamples;
        g.state = State.Open;
        g.nextBatch = NONE;
        g.cap = cap < MAX_NOTIONAL ? cap : MAX_NOTIONAL;
        for (uint8 t; t < 2; ++t) {
            Team storage tm = _teams[groupId][t];
            tm.P = ONE;
            tm.Q = ONE;
        }
        emit GroupCreated(groupId, msg.sender, d.conditionId, d.closeTime, g.cap, yesName, noName);
    }

    // ---------------------------------------------------------------- batches

    function batchOf(uint256 groupId, uint256 t) public view returns (uint64) {
        return uint64((t - _groups[groupId].createdAt) / PERIOD);
    }

    /// @notice The price window of batch `k`: it starts when the batch stops collecting.
    function windowOf(uint256 groupId, uint64 k) public view returns (uint64 start, uint64 end) {
        Group storage g = _groups[groupId];
        start = g.createdAt + (k + 1) * PERIOD;
        end = start + g.window;
    }

    function _touch(uint256 groupId, uint64 k) internal {
        uint64[] storage q = _active[groupId];
        if (q.length == 0 || q[q.length - 1] != k) q.push(k);
        Group storage g = _groups[groupId];
        if (g.nextBatch == NONE) g.nextBatch = k;
    }

    function _openBatch(uint256 groupId) internal view returns (uint64 k) {
        Group storage g = _groups[groupId];
        if (g.state != State.Open) revert WrongState();
        k = batchOf(groupId, block.timestamp);
        (, uint64 end) = windowOf(groupId, k);
        if (end + 60 > g.closeTime) revert TooLate();
    }

    // ---------------------------------------------------------------- join and leave

    /// @notice Asks to join `team` with `amount` (escrowed now). Cleared at the next batch's price;
    ///         an unfilled rest waits (up to MAX_WAIT batches) or comes back, as chosen.
    function join(uint256 groupId, uint8 team, uint256 amount, bool wait) external nonReentrant {
        if (team > 1 || amount < MIN_JOIN) revert BadParams();
        uint64 k = _openBatch(groupId);
        Position storage pos = _positions[groupId][msg.sender];
        if (pos.active && pos.team != team) revert BadParams(); // one team per account per group
        Request storage r = requests[groupId][msg.sender];
        if (r.active) {
            // only add to a join of the same batch and team that is not cleared yet
            if (r.batch != k || r.team != team || r.wait != wait) revert Busy();
            r.escrow += amount;
        } else {
            requests[groupId][msg.sender] = Request(k, team, wait, true, amount, 0, 0, 0);
        }
        BatchTeam storage bt = _bt[groupId][k][team];
        bt.newJoin += amount;
        if (wait) bt.newWait += amount;
        _touch(groupId, k);
        _groups[groupId].balance += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit JoinRequested(groupId, msg.sender, team, amount, wait, k);
    }

    /// @notice Asks to leave `notional` of your position, priced at the next batch's window: first
    ///         waiting joins of your team take it over, else the other team shrinks.
    function leave(uint256 groupId, uint256 notional) external nonReentrant {
        uint64 k = _openBatch(groupId);
        _claim(groupId, msg.sender);
        Position storage pos = _positions[groupId][msg.sender];
        Exit storage e = exits[groupId][msg.sender];
        if (!pos.active || e.active || notional == 0) revert BadParams();
        uint256 n = _value(groupId, pos.team, pos.n0, pos.snap);
        if (notional > n) revert BadParams();
        _setPosition(groupId, msg.sender, pos.team, n - notional);
        Team storage tm = _teams[groupId][pos.team];
        tm.pool -= notional > tm.pool ? tm.pool : notional;
        tm.exiting += notional;
        exits[groupId][msg.sender] = Exit(true, k, notional);
        _bt[groupId][k][pos.team].exits += notional;
        _touch(groupId, k);
        emit LeaveRequested(groupId, msg.sender, pos.team, notional, k);
    }

    // ---------------------------------------------------------------- clearing

    /// @notice Clears batch `k` with its window attestation (in order; anyone may call).
    function clear(uint256 groupId, WindowAttestation calldata a, bytes calldata sigs) external nonReentrant {
        Group storage g = _groups[groupId];
        uint64 k = a.nonce;
        if (g.state != State.Open || k != g.nextBatch) revert WrongState();
        (uint64 ws, uint64 we) = windowOf(groupId, k);
        if (a.potId != groupId || a.kind != KIND_BATCH || a.windowStart != ws || a.windowEnd != we) revert InvalidAttestation();
        if (we > block.timestamp) revert TooEarly();
        if (a.priceYes > PPM || (a.valid && a.sampleCount < g.minSamples)) revert InvalidAttestation();
        if (!SignatureChecker.isValidERC1271SignatureNow(g.resolver, windowDigest(a), sigs)) revert InvalidAttestation();
        if (!a.valid || a.priceYes < MIN_PRICE || a.priceYes > MAX_PRICE || we > g.closeTime) return _fail(groupId, k);
        _clear(groupId, k, a.priceYes);
    }

    /// @notice A batch whose window got no attestation in time fails: joins wait or come back,
    ///         leaves are returned.
    function failBatch(uint256 groupId) external nonReentrant {
        Group storage g = _groups[groupId];
        uint64 k = g.nextBatch;
        if (g.state != State.Open || k == NONE) revert WrongState();
        (, uint64 we) = windowOf(groupId, k);
        if (block.timestamp <= we + ATTEST_TIMEOUT) revert TooEarly();
        _fail(groupId, k);
    }

    struct Clr {
        uint256 q0;
        uint256 q1;
        uint256[2] avail;
        uint256[2] take; // takeover notional per team
        uint256[2] escrowUsed;
        uint256[2] rest;
        uint256 c;
        uint256 m;
    }

    function _clear(uint256 groupId, uint64 k, uint32 price) internal {
        Clr memory c;
        c.q0 = price;
        c.q1 = PPM - price;
        Team storage t0 = _teams[groupId][YES];
        Team storage t1 = _teams[groupId][NO];
        BatchTeam storage b0 = _bt[groupId][k][YES];
        BatchTeam storage b1 = _bt[groupId][k][NO];
        c.avail[0] = b0.newJoin + (t0.carryBase * t0.Q) / ONE;
        c.avail[1] = b1.newJoin + (t1.carryBase * t1.Q) / ONE;
        // 1. takeover: waiting joins of the leaver's own team take the leaving notional
        c.take[0] = _min(b0.exits, (c.avail[0] * PPM) / c.q0);
        c.take[1] = _min(b1.exits, (c.avail[1] * PPM) / c.q1);
        c.escrowUsed[0] = _ceilDiv(c.take[0] * c.q0, PPM);
        c.escrowUsed[1] = _ceilDiv(c.take[1] * c.q1, PPM);
        c.rest[0] = b0.exits - c.take[0];
        c.rest[1] = b1.exits - c.take[1];
        // 2. leaves on both teams cancel each other
        c.c = _min(c.rest[0], c.rest[1]);
        uint256 r0 = c.rest[0] - c.c; // YES leavers left: the NO team shrinks
        uint256 r1 = c.rest[1] - c.c; // NO leavers left: the YES team shrinks
        // gains: each team gets the exit fees of the other team's leavers, and a shrinking team its value
        uint256 fee0 = (b0.exits * c.q0 * EXIT_FEE_BPS) / (PPM * 10_000); // paid by YES leavers to NO
        uint256 fee1 = (b1.exits * c.q1 * EXIT_FEE_BPS) / (PPM * 10_000);
        _gain(groupId, NO, fee0 + (r0 * c.q1) / PPM);
        _gain(groupId, YES, fee1 + (r1 * c.q0) / PPM);
        // 3. shrink the other team by what is left
        if (r0 > 0) _shrink(groupId, NO, r0);
        if (r1 > 0) _shrink(groupId, YES, r1);
        // leavers leave the team totals
        t0.exiting -= b0.exits;
        t1.exiting -= b1.exits;
        // 4. match new notional, within the cap
        {
            uint256 total = t0.pool + c.take[0]; // the team total after this batch's leaves (equal on both teams)
            uint256 room = g_cap(groupId) > total ? g_cap(groupId) - total : 0;
            uint256 m0 = ((c.avail[0] - c.escrowUsed[0]) * PPM) / c.q0;
            uint256 m1 = ((c.avail[1] - c.escrowUsed[1]) * PPM) / c.q1;
            c.m = _min(_min(m0, m1), room);
        }
        c.escrowUsed[0] += _ceilDiv(c.m * c.q0, PPM);
        c.escrowUsed[1] += _ceilDiv(c.m * c.q1, PPM);
        // the notional each join gets: from the matched notional itself, rounded down, so the joins
        // of a batch never get more notional than the pool takes in
        b0.nfrac = _nfrac(c.avail[0], c.q0, c.take[0] + c.m);
        b1.nfrac = _nfrac(c.avail[1], c.q1, c.take[1] + c.m);
        // snapshots where this batch's new notional enters (after the shrink), then add it
        b0.snap = _snapOf(groupId, YES);
        b1.snap = _snapOf(groupId, NO);
        t0.pool += c.take[0] + c.m;
        t1.pool += c.take[1] + c.m;
        // deposits (for a void): fills in, payouts out
        _deposits(groupId, k, c, r0, r1);
        // waiting joins: fill fractions and the carry
        _joins(groupId, k, YES, c.avail[0], c.escrowUsed[0]);
        _joins(groupId, k, NO, c.avail[1], c.escrowUsed[1]);
        batches[groupId][k] = Batch(true, false, price);
        _advance(groupId, k);
        emit BatchCleared(groupId, k, price, c.m, c.take[0], c.take[1], c.c, r1, r0);
    }

    function _nfrac(uint256 avail, uint256 q, uint256 granted) internal pure returns (uint256 f) {
        uint256 could = (avail * PPM) / q;
        if (could == 0) return 0;
        f = (granted * ONE) / could;
        if (f > ONE) f = ONE;
    }

    function g_cap(uint256 groupId) internal view returns (uint256) {
        return _groups[groupId].cap;
    }

    function _deposits(uint256 groupId, uint64 k, Clr memory c, uint256 r0, uint256 r1) internal {
        Team storage t0 = _teams[groupId][YES];
        Team storage t1 = _teams[groupId][NO];
        BatchTeam storage b0 = _bt[groupId][k][YES];
        BatchTeam storage b1 = _bt[groupId][k][NO];
        uint256 out0 = (b0.exits * c.q0) / PPM; // gross value of YES leaves (their fee then goes to NO)
        uint256 out1 = (b1.exits * c.q1) / PPM;
        uint256 fee0 = (b0.exits * c.q0 * EXIT_FEE_BPS) / (PPM * 10_000);
        uint256 fee1 = (b1.exits * c.q1 * EXIT_FEE_BPS) / (PPM * 10_000);
        t0.deposits += int256(c.escrowUsed[0]) - int256(out0 - fee0) - int256(fee1 + (r1 * c.q0) / PPM);
        t1.deposits += int256(c.escrowUsed[1]) - int256(out1 - fee1) - int256(fee0 + (r0 * c.q1) / PPM);
    }

    function _joins(uint256 groupId, uint64 k, uint8 team, uint256 avail, uint256 used) internal {
        Team storage tm = _teams[groupId][team];
        BatchTeam storage bt = _bt[groupId][k][team];
        uint256 phi = avail == 0 ? 0 : (used * ONE) / avail;
        if (phi > ONE) phi = ONE;
        bt.phi = phi;
        bt.qBefore = tm.Q;
        bt.jeBefore = tm.joinEpoch;
        if (phi == ONE) {
            // every waiting join filled in full: a fresh join epoch
            tm.joinEpoch += 1;
            tm.Q = ONE;
            tm.carryBase = 0;
        } else {
            tm.Q = (tm.Q * (ONE - phi)) / ONE;
            if (tm.Q == 0) {
                tm.joinEpoch += 1;
                tm.Q = ONE;
                tm.carryBase = 0;
            } else {
                uint256 gone = _expBase[groupId][team][tm.joinEpoch][k];
                tm.carryBase = tm.carryBase > gone ? tm.carryBase - gone : 0;
                // this batch's waiting joins: their rest waits from here
                uint256 restWait = (bt.newWait * (ONE - phi)) / ONE;
                if (restWait > 0) {
                    uint256 base = (restWait * ONE) / tm.Q;
                    tm.carryBase += base;
                    _expBase[groupId][team][tm.joinEpoch][k + MAX_WAIT] += base;
                }
            }
        }
        bt.qAfter = tm.Q;
        bt.jeAfter = tm.joinEpoch;
    }

    function _fail(uint256 groupId, uint64 k) internal {
        for (uint8 t; t < 2; ++t) {
            Team storage tm = _teams[groupId][t];
            BatchTeam storage bt = _bt[groupId][k][t];
            // leaves go back into the team at the current snapshot
            tm.exiting -= bt.exits;
            bt.snap = _snapOf(groupId, t);
            tm.pool += bt.exits;
            _joins(groupId, k, t, 1, 0); // nothing filled: waiting joins carry on, expiries apply
        }
        batches[groupId][k] = Batch(true, true, 0);
        _advance(groupId, k);
        emit BatchFailed(groupId, k);
    }

    function _advance(uint256 groupId, uint64 k) internal {
        Group storage g = _groups[groupId];
        uint64[] storage q = _active[groupId];
        uint256 h = _activeHead[groupId];
        while (h < q.length && q[h] <= k) ++h; // at most one or two steps: entries are increasing
        _activeHead[groupId] = h;
        if (_teams[groupId][YES].carryBase > 0 || _teams[groupId][NO].carryBase > 0) g.nextBatch = k + 1;
        else g.nextBatch = h < q.length ? q[h] : NONE;
    }

    // ---------------------------------------------------------------- product-sum

    function _snapOf(uint256 groupId, uint8 team) internal view returns (Snap memory s) {
        Team storage tm = _teams[groupId][team];
        s = Snap(tm.P, _sums[groupId][team][tm.epoch][tm.scale], tm.scale, tm.epoch);
    }

    /// @dev Pays `amount` to the team pro rata (no shrink). With nobody in the team, it stays as dust.
    function _gain(uint256 groupId, uint8 team, uint256 amount) internal {
        Team storage tm = _teams[groupId][team];
        if (amount == 0 || tm.pool == 0) return;
        uint256 marginal = (amount * ONE) / tm.pool;
        _sums[groupId][team][tm.epoch][tm.scale] += marginal * tm.P;
    }

    /// @dev Shrinks every position of the team by `r` in total, pro rata (Liquity's P update).
    function _shrink(uint256 groupId, uint8 team, uint256 r) internal {
        Team storage tm = _teams[groupId][team];
        if (r >= tm.pool) {
            tm.epoch += 1;
            tm.scale = 0;
            tm.P = ONE;
            tm.pool = 0;
            return;
        }
        uint256 frac = _ceilDiv(r * ONE, tm.pool); // round the shrink up: positions keep slightly less
        uint256 factor = ONE - frac;
        uint256 newP = (tm.P * factor) / ONE;
        if (newP < SCALE_FACTOR) {
            newP = (tm.P * factor * SCALE_FACTOR) / ONE;
            tm.scale += 1;
        }
        if (newP == 0) {
            tm.epoch += 1;
            tm.scale = 0;
            tm.P = ONE;
            tm.pool = 0;
            return;
        }
        tm.P = newP;
        tm.pool -= r;
    }

    function _value(uint256 groupId, uint8 team, uint256 n0, Snap memory s) internal view returns (uint256) {
        Team storage tm = _teams[groupId][team];
        if (n0 == 0 || s.epoch < tm.epoch) return 0;
        uint128 diff = tm.scale - s.scale;
        if (diff == 0) return (n0 * tm.P) / s.P;
        if (diff == 1) return (n0 * tm.P) / s.P / SCALE_FACTOR;
        return 0;
    }

    function _gainSince(uint256 groupId, uint8 team, uint256 n0, Snap memory s) internal view returns (uint256) {
        if (n0 == 0) return 0;
        uint256 first = _sums[groupId][team][s.epoch][s.scale] - s.S;
        uint256 second = _sums[groupId][team][s.epoch][s.scale + 1] / SCALE_FACTOR;
        return (n0 * (first + second)) / s.P / ONE;
    }

    /// @dev Brings a position to now: its payouts so far become claimable.
    function _compound(uint256 groupId, address who) internal returns (uint256 n) {
        Position storage pos = _positions[groupId][who];
        if (!pos.active) return 0;
        uint256 gain = _gainSince(groupId, pos.team, pos.n0, pos.snap);
        n = _value(groupId, pos.team, pos.n0, pos.snap);
        if (gain > 0) claimable[groupId][who] += gain;
        pos.n0 = n;
        pos.snap = _snapOf(groupId, pos.team);
    }

    function _setPosition(uint256 groupId, address who, uint8 team, uint256 n) internal {
        Position storage pos = _positions[groupId][who];
        pos.active = true;
        pos.team = team;
        pos.n0 = n;
        pos.snap = _snapOf(groupId, team);
    }

    /// @dev Adds a piece that entered the team at snapshot `s` to a position (now).
    function _addPiece(uint256 groupId, address who, uint8 team, uint256 n, Snap memory s) internal {
        if (n == 0) return;
        uint256 gain = _gainSince(groupId, team, n, s);
        uint256 now_ = _value(groupId, team, n, s);
        if (gain > 0) claimable[groupId][who] += gain;
        uint256 cur = _compound(groupId, who);
        _setPosition(groupId, who, team, cur + now_);
    }

    // ---------------------------------------------------------------- claims

    /// @notice Brings an account up to date: filled joins become notional, refunds and payouts
    ///         become claimable. Anyone may call it for anyone.
    function claim(uint256 groupId, address who) external nonReentrant {
        _claim(groupId, who);
    }

    function _claim(uint256 groupId, address who) internal {
        _claimRequest(groupId, who);
        _claimExit(groupId, who);
        _compound(groupId, who);
    }

    function _claimRequest(uint256 groupId, address who) internal {
        Request storage r = requests[groupId][who];
        if (!r.active) return;
        Group storage g = _groups[groupId];
        uint8 team = r.team;
        if (r.next == 0) {
            // the first batch
            Batch storage b = batches[groupId][r.batch];
            if (!b.done) {
                if (g.state != State.Open) {
                    _refund(groupId, who, r.escrow);
                    r.active = false;
                }
                return;
            }
            BatchTeam storage bt = _bt[groupId][r.batch][team];
            uint256 filled = (r.escrow * bt.phi) / ONE;
            if (filled > 0) _addPiece(groupId, who, team, (((r.escrow * PPM) / _teamPrice(b.price, team)) * bt.nfrac) / ONE, bt.snap);
            uint256 rest = r.escrow - filled;
            if (!r.wait || rest == 0 || bt.jeAfter != bt.jeBefore) {
                // no waiting, or all filled (a fresh join epoch means every waiting join was filled)
                if (rest > 0 && (!r.wait || bt.jeAfter == bt.jeBefore)) _refund(groupId, who, rest);
                r.active = false;
                return;
            }
            r.base = (rest * ONE) / bt.qAfter;
            r.joinEpoch = bt.jeAfter;
            r.next = r.batch + 1;
        }
        // later batches, while waiting
        uint64 last = r.batch + MAX_WAIT;
        while (r.next <= last) {
            Batch storage b = batches[groupId][r.next];
            if (!b.done) {
                if (g.state != State.Open) break; // settled meanwhile: the rest comes back below
                return; // not cleared yet: claim again later
            }
            BatchTeam storage bt = _bt[groupId][r.next][team];
            if (bt.jeBefore != r.joinEpoch) {
                // the join epoch moved on before this batch: this join was filled in full earlier
                r.base = 0;
                break;
            }
            uint256 avail = (r.base * bt.qBefore) / ONE;
            uint256 filled = (avail * bt.phi) / ONE;
            if (filled > 0) _addPiece(groupId, who, team, (((avail * PPM) / _teamPrice(b.price, team)) * bt.nfrac) / ONE, bt.snap);
            if (bt.jeAfter != bt.jeBefore) {
                r.base = 0; // filled in full in this batch
                r.next += 1;
                break;
            }
            r.next += 1;
        }
        if (r.next > last || g.state != State.Open || r.base == 0) {
            // done waiting: the rest comes back
            uint256 rest = 0;
            if (r.base > 0) {
                uint64 lastDone = r.next - 1;
                BatchTeam storage lb = _bt[groupId][lastDone][team];
                rest = lb.jeAfter == r.joinEpoch ? (r.base * lb.qAfter) / ONE : 0;
            }
            if (rest > 0) _refund(groupId, who, rest);
            r.active = false;
        }
    }

    function _claimExit(uint256 groupId, address who) internal {
        Exit storage e = exits[groupId][who];
        if (!e.active) return;
        Batch storage b = batches[groupId][e.batch];
        Position storage pos = _positions[groupId][who];
        if (!b.done) {
            if (_groups[groupId].state == State.Open) return;
            // settled before the leave was priced: it goes back into the position (the team's pool
            // already took it back in _returnExiting)
            uint256 cur = _compound(groupId, who);
            _setPosition(groupId, who, pos.team, cur + e.x);
            e.active = false;
            return;
        }
        if (b.failed) {
            _addPiece(groupId, who, pos.team, e.x, _bt[groupId][e.batch][pos.team].snap);
        } else {
            // the fee rounds up per leaver, so leavers together never get more than the batch released
            uint256 value = (e.x * _teamPrice(b.price, pos.team)) / PPM;
            uint256 fee = _ceilDiv(e.x * _teamPrice(b.price, pos.team) * EXIT_FEE_BPS, PPM * 10_000);
            claimable[groupId][who] += value > fee ? value - fee : 0;
        }
        e.active = false;
    }

    function _refund(uint256 groupId, address who, uint256 amount) internal {
        claimable[groupId][who] += amount;
    }

    /// @notice Sends what an account can claim in a group (after bringing it up to date).
    function withdraw(uint256 groupId) external nonReentrant {
        _claim(groupId, msg.sender);
        Group storage g = _groups[groupId];
        if (g.state == State.Settled || g.state == State.Void) _final(groupId, msg.sender);
        uint256 amount = claimable[groupId][msg.sender];
        if (amount == 0) revert NothingToDo();
        claimable[groupId][msg.sender] = 0;
        // Rounding is against the payee everywhere, so this should never bind; if it ever did, the
        // last withdrawer gets a few base units less instead of the group paying more than it holds.
        if (amount > g.balance) amount = g.balance;
        g.balance -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(groupId, msg.sender, amount);
    }

    /// @dev After settlement: the position's final payout.
    function _final(uint256 groupId, address who) internal {
        Position storage pos = _positions[groupId][who];
        if (!pos.active) return;
        Group storage g = _groups[groupId];
        uint256 n = pos.n0; // compounded to now by _claim
        uint256 pay;
        if (g.state == State.Settled) {
            if ((g.outcome == 1 && pos.team == YES) || (g.outcome == 0 && pos.team == NO)) pay = n;
        } else {
            Team storage tm = _teams[groupId][pos.team];
            Team storage other = _teams[groupId][1 - pos.team];
            int256 pot = tm.deposits + other.deposits;
            int256 mine = tm.deposits < 0 ? int256(0) : (tm.deposits > pot ? pot : tm.deposits);
            if (mine > 0 && tm.pool > 0) pay = (n * uint256(mine)) / tm.pool;
        }
        pos.active = false;
        pos.n0 = 0;
        if (pay > 0) claimable[groupId][who] += pay;
        emit Claimed(groupId, who, pay);
    }

    // ---------------------------------------------------------------- settle

    /// @notice Settles on the market's result, attested by the samplers (2 of 3).
    function settle(uint256 groupId, OutcomeAttestation calldata o, bytes calldata sigs) external nonReentrant {
        Group storage g = _groups[groupId];
        if (g.state != State.Open) revert WrongState();
        if (block.timestamp < g.closeTime) revert TooEarly();
        if (block.timestamp > g.deadline) revert TooLate();
        if (o.potId != groupId || o.conditionId != g.conditionId || o.outcome > 2) revert InvalidAttestation();
        if (!SignatureChecker.isValidERC1271SignatureNow(g.resolver, outcomeDigest(o), sigs)) revert InvalidAttestation();
        _returnExiting(groupId);
        if (o.outcome == 2) {
            g.state = State.Void;
            emit GroupVoided(groupId);
        } else {
            g.state = State.Settled;
            g.outcome = o.outcome;
            emit GroupSettled(groupId, o.outcome, o.evidenceHash);
        }
    }

    /// @notice No result by the deadline: everyone gets their team's remaining deposit back, pro rata.
    function voidLate(uint256 groupId) external nonReentrant {
        Group storage g = _groups[groupId];
        if (g.state != State.Open) revert WrongState();
        if (block.timestamp <= g.deadline) revert TooEarly();
        _returnExiting(groupId);
        g.state = State.Void;
        emit GroupVoided(groupId);
    }

    /// @dev Leaves not yet priced count back into the pools (each returns into its position on claim).
    function _returnExiting(uint256 groupId) internal {
        for (uint8 t; t < 2; ++t) {
            Team storage tm = _teams[groupId][t];
            tm.pool += tm.exiting;
            tm.exiting = 0;
        }
    }

    // ---------------------------------------------------------------- positions

    /// @notice Moves your whole position to `to` (who holds none in this group); nothing pending.
    function transferPosition(uint256 groupId, address to) external nonReentrant {
        if (to == address(0) || to == msg.sender) revert BadParams();
        _claim(groupId, msg.sender);
        Position storage from = _positions[groupId][msg.sender];
        if (!from.active || requests[groupId][msg.sender].active || exits[groupId][msg.sender].active) revert Busy();
        if (_positions[groupId][to].active || requests[groupId][to].active || exits[groupId][to].active) revert Busy();
        _positions[groupId][to] = from;
        delete _positions[groupId][msg.sender];
        emit PositionTransferred(groupId, msg.sender, to);
    }

    // ---------------------------------------------------------------- views

    function group(uint256 groupId) external view returns (Group memory) {
        return _groups[groupId];
    }

    function team(uint256 groupId, uint8 t) external view returns (Team memory) {
        return _teams[groupId][t];
    }

    function batchTeam(uint256 groupId, uint64 k, uint8 t) external view returns (BatchTeam memory) {
        return _bt[groupId][k][t];
    }

    /// @notice A position's notional now and its payouts not yet claimed (before a claim).
    function positionOf(uint256 groupId, address who) external view returns (bool active, uint8 t, uint256 notional, uint256 pending) {
        Position storage pos = _positions[groupId][who];
        if (!pos.active) return (false, 0, 0, 0);
        return (true, pos.team, _value(groupId, pos.team, pos.n0, pos.snap), _gainSince(groupId, pos.team, pos.n0, pos.snap));
    }

    // ---------------------------------------------------------------- helpers

    function _teamPrice(uint32 priceYes, uint8 t) internal pure returns (uint256) {
        return t == YES ? priceYes : PPM - priceYes;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
