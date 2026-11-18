// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {RopesBase} from "./RopesBase.sol";

/// @title  HonorCatRopesExtra
/// @notice The third part of HonorCat v2: read-only views (shares, fees, digests, times), settlement,
///         deadline expiry and the roll entry for perps. HonorCatRopes reaches it through its extension
///         by delegatecall, so everything here acts on HonorCatRopes' storage. Holds nothing itself.
contract HonorCatRopesExtra is RopesBase {
    constructor(IERC20 usdc_) RopesBase(usdc_, address(1)) {}

    // ---------------------------------------------------------------- views

    function yesShare(uint256 size, uint256 price, uint256 lower, uint256 upper) external pure returns (uint256) {
        return _yesShare(size, price, lower, upper);
    }

    function potValue(uint256 size, uint256 lower, uint256 upper) external pure returns (uint256) {
        return _potValue(size, lower, upper);
    }

    function exitFee(uint256 exited) external pure returns (uint256) {
        return _exitFee(exited);
    }

    function makerTreat(uint256 deposit) external pure returns (uint256) {
        return _makerTreat(deposit);
    }

    function divideMath(uint8 exitSide, uint256 size, uint32 price, bool withFee, uint256 lower, uint256 upper)
        external
        pure
        returns (uint256 payYes, uint256 payNo, uint256 fee)
    {
        return _divideMath(exitSide, size, price, withFee, lower, upper);
    }

    function tokenOf(uint256 potId, uint8 side) external pure returns (uint256) {
        return _tokenOf(potId, side);
    }

    /// @notice Each side's share of the whole pot at `price`.
    function shares(uint256 potId, uint32 price) external view returns (uint256 yes, uint256 no) {
        Pot storage p = _pots[potId];
        yes = _yesShare(p.size, price, p.lower, p.upper);
        no = _total(p) - yes;
    }

    function lockout(uint256 potId) external view returns (uint64) {
        return _lockout(_pots[potId]);
    }

    function endTime(uint256 potId) external view returns (uint64) {
        return _end(_pots[potId]);
    }

    function expiryWindowStart(uint256 potId, uint8 attempt) external view returns (uint64) {
        return _expiryStart(_pots[potId], attempt);
    }

    function outcomeDigest(OutcomeAttestation calldata a) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(OUTCOME_TYPEHASH, a.potId, a.conditionId, a.outcome, a.evidenceHash)));
    }

    function exitRequestDigest(uint256 potId, uint8 side, uint256 size, uint256 deadline) external view returns (bytes32) {
        return _exitRequestDigest(potId, side, size, deadline);
    }

    function handshakeDigest(uint256 potId, uint32 priceYes, uint256 size, uint256 deadline) external view returns (bytes32) {
        return _handshakeDigest(potId, priceYes, size, deadline);
    }

    function depositNonce(bytes32 action, bytes32 salt) external view returns (bytes32) {
        return keccak256(abi.encode(DEPOSIT_TAG, block.chainid, address(this), action, salt));
    }

    // ---------------------------------------------------------------- settle / expire

    /// @notice Ends a pot still running at Gemini's settlement: YES counts as price 100 and NO as 0,
    ///         clamped to the posts (normal pot: the winner gets everything). Void: deposits back.
    function settle(OutcomeAttestation calldata a, bytes calldata sigs) external nonReentrant {
        Pot storage p = _pots[a.potId];
        if (p.state != State.Live && p.state != State.ExitRequested) revert WrongState();
        if (block.timestamp < p.closeTime) revert TooEarly();
        if (a.conditionId != p.conditionId || a.outcome > OUTCOME_VOID) revert InvalidAttestation();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(OUTCOME_TYPEHASH, a.potId, a.conditionId, a.outcome, a.evidenceHash)));
        if (!SignatureChecker.isValidERC1271SignatureNow(p.resolver, digest, sigs)) revert InvalidAttestation();
        _refundTaker(a.potId, p); // a pending exit is dropped
        uint256 total = _total(p);
        uint256 payYes;
        if (a.outcome == OUTCOME_YES) payYes = total;
        else if (a.outcome == OUTCOME_VOID) payYes = _yesShare(p.size, p.entry, p.lower, p.upper);
        uint256 payNo = total - payYes;
        p.size = 0;
        p.state = a.outcome == OUTCOME_VOID ? State.Expired : State.Settled;
        emit PotSettled(a.potId, a.outcome, payYes, payNo, a.evidenceHash);
        _record(a.potId, a.outcome == OUTCOME_YES ? uint32(P) : a.outcome == OUTCOME_NO ? 0 : p.entry, a.outcome == OUTCOME_VOID ? R_EXPIRED : R_SETTLED, payYes, payNo);
        _endWith(a.potId, payYes, payNo);
    }

    /// @notice After the deadline anyone can end any pot still running: deposits (or escrows) go back.
    function expire(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        State s = p.state;
        if (s == State.None || s == State.Divided || s == State.Settled || s == State.Expired) revert WrongState();
        if (block.timestamp < p.deadline) revert TooEarly();
        if (s == State.Open || s == State.Joining) {
            if (s == State.Joining) {
                uint8 joinSide = 1 - p.creatorSide;
                uint256 r = joinSide == YES ? p.escrowYes : p.escrowNo;
                if (joinSide == YES) p.escrowYes = 0;
                else p.escrowNo = 0;
                address joiner = p.joiner;
                p.joiner = address(0);
                p.joinerLeader = address(0);
                _pay(potId, joiner, r);
            }
            _refundEscrowsAndExpire(potId, p);
            return;
        }
        _refundTaker(potId, p);
        uint256 payYes = _yesShare(p.size, p.entry, p.lower, p.upper);
        uint256 payNo = _total(p) - payYes;
        p.size = 0;
        p.state = State.Expired;
        emit PotExpired(potId, payYes, payNo);
        _record(potId, p.entry, R_EXPIRED, payYes, payNo);
        _endWith(potId, payYes, payNo);
    }

    function _endWith(uint256 potId, uint256 payYes, uint256 payNo) internal {
        uint256 y = _tokenOf(potId, YES);
        uint256 n = _tokenOf(potId, NO);
        _payPosition(potId, y, ownerOf(y), payYes);
        _payPosition(potId, n, ownerOf(n), payNo);
        _endPot(potId);
    }

    // ---------------------------------------------------------------- roll (v2.1, perps)

    /// @notice Opens the next rope of a chain with both sides funded by the caller, who must hold both sides
    ///         of `fromPot`. The entry is `fromPot`'s division price (a knock-out or an expiry, so it was
    ///         priced forward from the samplers' window), within ROLL_WINDOW, once per pot. Every check of
    ///         `create` applies (depth and cap, posts, leverage, margin, expiry, lock-out). No maker treat.
    function openFunded(CreateParams calldata c, uint256 fromPot, DepthAttestation calldata d, bytes calldata depthSigs)
        external
        nonReentrant
        returns (uint256 potId)
    {
        if (paused) revert PausedForNewPots();
        Pot storage f = _pots[fromPot];
        Division memory dv = divisions[fromPot];
        if (f.state != State.Divided || (dv.reason != R_KNOCK && dv.reason != R_EXPIRY) || rolledFrom[fromPot] || block.timestamp > dv.at + ROLL_WINDOW) {
            revert WrongState();
        }
        if (ownerOf(_tokenOf(fromPot, YES)) != msg.sender || ownerOf(_tokenOf(fromPot, NO)) != msg.sender) revert NotOwner();
        uint256 e = (uint256(dv.price) / TICK) * TICK;
        if (c.conditionId != f.conditionId || c.resolver != f.resolver || c.bandCenter != e || c.tolerance != 0 || c.copyOf != 0) revert BadParams();
        if (
            d.conditionId != c.conditionId || d.account != msg.sender || d.closeTime != c.closeTime || block.timestamp > d.validUntil
                || !SignatureChecker.isValidERC1271SignatureNow(c.resolver, _depthDigest(d), depthSigs)
        ) revert InvalidAttestation();
        if (c.size * CAP_DIVISOR > d.contracts5c) revert AboveCap();
        if (c.side > NO || c.size == 0 || c.grace < MIN_GRACE || c.window < MIN_WINDOW || c.window > MAX_WINDOW || c.minSamples == 0) revert BadParams();
        _checkRope(c, d);
        if (_maxPotValue(c) > globalMaxPot) revert AboveCap();
        rolledFrom[fromPot] = true;

        potId = nextPotId++;
        Pot storage p = _pots[potId];
        p.conditionId = c.conditionId;
        p.resolver = c.resolver;
        p.size = c.size;
        p.bandCenter = c.bandCenter;
        p.distYes = c.distYes;
        p.distNo = c.distNo;
        p.expiry = c.expiry;
        p.window = c.window;
        p.minSamples = c.minSamples;
        p.creatorSide = c.side;
        p.closeTime = c.closeTime;
        p.deadline = c.closeTime + c.grace;
        _beforeLockout(p);
        uint256 L = c.distYes == 0 ? 0 : e - c.distYes;
        uint256 U = c.distNo == 0 ? P : e + c.distNo;
        p.entry = uint32(e);
        p.lower = uint32(L);
        p.upper = uint32(U);
        p.armedAt = uint64(block.timestamp);
        p.state = State.Live;
        uint256 dy = _yesShare(c.size, e, L, U);
        uint256 dn = _potValue(c.size, L, U) - dy;
        _pullCaller(dy + dn);
        _mint(msg.sender, _tokenOf(potId, YES));
        _mint(msg.sender, _tokenOf(potId, NO));
        emit PotCreated(potId, msg.sender, c.side, c.size, c.bandCenter, 0, c.distYes, c.distNo, c.expiry, dy + dn);
        emit Joined(potId, uint32(e), uint32(L), uint32(U), dy, dn, bytes32(fromPot));
        emit Rolled(fromPot, potId, msg.sender, uint32(e));
    }

}
