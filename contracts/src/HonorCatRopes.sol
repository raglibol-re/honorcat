// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {RopesBase} from "./ropes/RopesBase.sol";

/// @title  HonorCatRopes (HonorCat v2)
/// @notice Two sides, one pot, one Gemini prediction contract, fully collateralised in USDC, with an
///         optional short rope: a lower post L and an upper post U around the entry price. YES's share
///         at price p is (clamp(p, L, U) − L) per contract, NO's the rest of the pot; a normal pot is
///         L = 0, U = 100. A short rope ends by knock-out (the smoothed price held at a post) or at its
///         expiry, priced forward and divided at the clamped price, at the latest 2 hours before
///         trading closes. No side can lose more than its deposit and nothing is ever owed.
///         Fees are constants and every one goes to a player (maker treat, exit fee, referral share,
///         copycat treat); OPERATOR_FEE_BPS is 0 and there is no operator recipient.
/// @dev    This address holds every pot's USDC and all state. Functions not defined here (extra lives,
///         takeover offers, handshakes, nets and bowls, settlement, expiry of the deadline, cancel,
///         abandon, referral, withdraw, admin) run from HonorCatRopesExtension by delegatecall, on this
///         contract's storage. Design: docs/rope-design.md.
contract HonorCatRopes is RopesBase {
    /// @notice Code for the remaining functions, fixed for life.
    address public immutable extension;

    constructor(IERC20 usdc_, address owner_, address extension_) RopesBase(usdc_, owner_) {
        if (extension_.code.length == 0) revert BadParams();
        extension = extension_;
    }

    /// @dev Everything not defined here is the extension's, run on this storage.
    fallback() external {
        address ext = extension;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), ext, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    // ---------------------------------------------------------------- views

    function pot(uint256 potId) external view returns (Pot memory) {
        return _pots[potId];
    }

    function windowDigest(WindowAttestation calldata a) external view returns (bytes32) {
        return _windowDigest(a);
    }

    function depthDigest(DepthAttestation calldata d) public view returns (bytes32) {
        return _depthDigest(d);
    }

    // ---------------------------------------------------------------- create / join

    /// @notice Offers a pot. The creator escrows its side's worst case in the band. A short rope sets
    ///         `distYes` and/or `distNo` (the posts are placed around the entry price at the join) and an
    ///         expiry. `copyOf` (a token id, 0 = none) marks the creator's side as a copy.
    function create(CreateParams calldata c, DepthAttestation calldata d, bytes calldata depthSigs, Authorization calldata auth)
        external
        nonReentrant
        returns (uint256 potId)
    {
        if (paused) revert PausedForNewPots();
        address creator = _payer(auth);
        if (
            d.conditionId != c.conditionId || d.account != creator || d.closeTime != c.closeTime || block.timestamp > d.validUntil
                || !SignatureChecker.isValidERC1271SignatureNow(c.resolver, depthDigest(d), depthSigs)
        ) revert InvalidAttestation();
        if (c.size * CAP_DIVISOR > d.contracts5c) revert AboveCap();
        if (
            c.side > NO || c.size == 0 || c.resolver == address(0) || c.bandCenter > P || c.tolerance > MAX_TOLERANCE || c.grace < MIN_GRACE
                || c.window < MIN_WINDOW || c.window > MAX_WINDOW || c.minSamples == 0
        ) revert BadParams();
        _checkRope(c, d);
        uint256 escrowY = _worstDeposit(YES, c);
        uint256 escrowN = _worstDeposit(NO, c);
        if (_maxPotValue(c) > globalMaxPot) revert AboveCap(); // the most the pot can hold at any entry in the band

        potId = nextPotId++;
        Pot storage p = _pots[potId];
        p.conditionId = c.conditionId;
        p.resolver = c.resolver;
        p.size = c.size;
        p.bandCenter = c.bandCenter;
        p.tolerance = c.tolerance;
        p.distYes = c.distYes;
        p.distNo = c.distNo;
        p.expiry = c.expiry;
        p.window = c.window;
        p.minSamples = c.minSamples;
        p.creatorSide = c.side;
        p.closeTime = c.closeTime;
        p.deadline = c.closeTime + c.grace;
        _beforeLockout(p);
        p.state = State.Open;

        uint256 escrow = c.side == YES ? escrowY : escrowN;
        if (c.side == YES) p.escrowYes = escrow;
        else p.escrowNo = escrow;
        _pull(creator, escrow, keccak256(abi.encode("create", creator, c)), auth);
        uint256 tokenId = _tokenOf(potId, c.side);
        _mint(creator, tokenId);
        tokenReferrer[tokenId] = _enter(creator);
        if (c.copyOf != 0) {
            address leader = _leaderOf(potId, c.copyOf, creator);
            copies[tokenId].leader = leader;
            emit CopyMarked(tokenId, leader, c.copyOf);
        }
        emit PotCreated(potId, creator, c.side, c.size, c.bandCenter, c.tolerance, c.distYes, c.distNo, c.expiry, escrow);
    }

    /// @notice Requests to join as the other side, escrowing that side's worst case in the band plus the
    ///         maker treat on it. Binding: the entry price is the window average after this request.
    function requestJoin(uint256 potId, uint256 copyOf, Authorization calldata auth) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.Open) revert WrongState();
        _beforeLockout(p);
        address joiner = _payer(auth);
        uint8 side = 1 - p.creatorSide;
        uint256 dep = _worst(side, p.size, p.bandCenter, p.tolerance, p.distYes, p.distNo);
        uint256 escrow = dep + _makerTreat(dep);
        if (side == YES) p.escrowYes = escrow;
        else p.escrowNo = escrow;
        p.joiner = joiner;
        p.joinerLeader = copyOf == 0 ? address(0) : _leaderOf(potId, copyOf, joiner);
        p.requestTime = uint64(block.timestamp);
        p.nonce += 1;
        p.state = State.Joining;
        _pull(joiner, escrow, keccak256(abi.encode("join", potId, joiner, p.nonce, copyOf)), auth);
        emit JoinRequested(potId, joiner, p.nonce, p.requestTime, escrow);
    }

    /// @notice Completes a join at the attested entry price, sets the posts around it and pays the maker
    ///         treat to the opener; or (no valid price inside the band) refunds the joiner.
    function resolveJoin(WindowAttestation calldata a, bytes calldata sigs) external nonReentrant {
        Pot storage p = _pots[a.potId];
        if (p.state != State.Joining) revert WrongState();
        _checkWindow(p, a, KIND_JOIN, sigs);
        uint256 lo = p.tolerance > p.bandCenter ? 0 : p.bandCenter - p.tolerance;
        if (!a.valid || a.priceYes < lo || a.priceYes > uint256(p.bandCenter) + p.tolerance) {
            _failJoin(a.potId, p, a.evidenceHash);
            return;
        }
        _completeJoin(a.potId, p, (uint256(a.priceYes) / TICK) * TICK, a.evidenceHash);
    }

    function _completeJoin(uint256 potId, Pot storage p, uint256 e, bytes32 evidenceHash) internal {
        uint256 L = p.distYes == 0 ? 0 : e - p.distYes;
        uint256 U = p.distNo == 0 ? P : e + p.distNo;
        p.entry = uint32(e);
        p.lower = uint32(L);
        p.upper = uint32(U);
        p.armedAt = uint64(block.timestamp);
        uint256 dy = _yesShare(p.size, e, L, U);
        uint256 dn = _potValue(p.size, L, U) - dy;
        emit Joined(potId, uint32(e), uint32(L), uint32(U), dy, dn, evidenceHash);
        _payJoin(potId, p, dy, dn);
    }

    /// @dev Settles the escrows of a completed join: the maker treat to the opener, the rest of each escrow
    ///      back (>= 0: the entry is inside the band and each deposit is monotonic in it).
    function _payJoin(uint256 potId, Pot storage p, uint256 dy, uint256 dn) internal {
        uint8 joinSide = 1 - p.creatorSide;
        uint256 treat = _makerTreat(joinSide == YES ? dy : dn);
        uint256 refundYes = p.escrowYes - dy - (joinSide == YES ? treat : 0);
        uint256 refundNo = p.escrowNo - dn - (joinSide == NO ? treat : 0);
        p.escrowYes = 0;
        p.escrowNo = 0;
        p.state = State.Live;
        address joiner = _mintJoiner(potId, p, joinSide, (joinSide == YES ? dy : dn) + treat, joinSide == YES ? dn : dy);
        _payFee(potId, _tokenOf(potId, joinSide), joiner, ownerOf(_tokenOf(potId, p.creatorSide)), treat, 1);
        _pay(potId, ownerOf(_tokenOf(potId, YES)), refundYes);
        _pay(potId, ownerOf(_tokenOf(potId, NO)), refundNo);
    }

    /// @dev Mints the joiner's token, records its referral and copy, and adds the maker's deposit to a
    ///      copy the maker marked.
    function _mintJoiner(uint256 potId, Pot storage p, uint8 joinSide, uint256 joinerIn, uint256 makerIn) internal returns (address joiner) {
        joiner = p.joiner;
        p.joiner = address(0);
        uint256 joinToken = _tokenOf(potId, joinSide);
        _mint(joiner, joinToken);
        tokenReferrer[joinToken] = _enter(joiner);
        address leader = p.joinerLeader;
        if (leader != address(0)) {
            copies[joinToken] = Copy(leader, joinerIn, 0, 0);
            emit CopyMarked(joinToken, leader, 0);
            p.joinerLeader = address(0);
        }
        Copy storage mc = copies[_tokenOf(potId, p.creatorSide)];
        if (mc.leader != address(0)) mc.paidIn += makerIn;
    }

    function _failJoin(uint256 potId, Pot storage p, bytes32 evidenceHash) internal {
        uint8 joinSide = 1 - p.creatorSide;
        uint256 refund = joinSide == YES ? p.escrowYes : p.escrowNo;
        if (joinSide == YES) p.escrowYes = 0;
        else p.escrowNo = 0;
        address joiner = p.joiner;
        p.joiner = address(0);
        p.joinerLeader = address(0);
        p.state = State.Open;
        emit JoinFailed(potId, p.nonce, evidenceHash);
        _pay(potId, joiner, refund);
    }

    // ---------------------------------------------------------------- exit

    /// @notice Prices the pending exit or knock-out with the attested forward window and divides; or
    ///         (valid = false) lets the pot continue.
    function resolveExit(WindowAttestation calldata a, bytes calldata sigs) external nonReentrant {
        Pot storage p = _pots[a.potId];
        if (p.state != State.ExitRequested) revert WrongState();
        _checkWindow(p, a, KIND_EXIT, sigs);
        if (!a.valid) {
            _exitFailed(a.potId, p, a.evidenceHash);
            return;
        }
        if (p.joiner != address(0)) {
            _completeTakeover(a.potId, p, a.priceYes);
            return;
        }
        if (p.knock) _divide(a.potId, p, p.exitSide, p.size, a.priceYes, false, R_KNOCK, a.evidenceHash);
        else _divide(a.potId, p, p.exitSide, p.exitSize, a.priceYes, true, R_EXIT, a.evidenceHash);
    }

    /// @dev The exiter receives its share minus the fee, the other side the fee, the taker its escrow minus
    ///      the share and the exiting side's token. The pot continues.
    function _completeTakeover(uint256 potId, Pot storage p, uint32 price) internal {
        uint8 side = p.exitSide;
        uint256 total = _total(p);
        uint256 cashYes = _yesShare(p.size, price, p.lower, p.upper);
        uint256 cash = side == YES ? cashYes : total - cashYes;
        uint256 fee = _exitFee(total);
        if (fee > cash) fee = cash;
        address taker = p.joiner;
        p.joiner = address(0);
        p.state = State.Live;
        uint256 tokenId = _tokenOf(potId, side);
        address exiter = ownerOf(tokenId);
        emit TakenOver(potId, side, exiter, taker, price, cash - fee, fee);
        _payPosition(potId, tokenId, exiter, cash - fee);
        _payFee(potId, tokenId, exiter, ownerOf(_tokenOf(potId, 1 - side)), fee, 0);
        _transfer(exiter, taker, tokenId); // ends the exiter's copy tenure; resets levels and referral
        _pay(potId, taker, total - cash);
    }

    // ---------------------------------------------------------------- knock-out

    /// @notice Anyone may submit the signer set's attestation that the smoothed price held at or beyond a
    ///         post for a full window that started after the posts last moved. That files a binding
    ///         knock-out: priced forward like an exit, divided at the clamped price, no fee; the pot ends.
    function triggerKnockOut(WindowAttestation calldata a, bytes calldata sigs) external {
        Pot storage p = _pots[a.potId];
        if (p.state != State.Live || p.expiry == 0) revert WrongState();
        _beforeLockout(p);
        if (a.kind != KIND_KNOCK || !a.valid || a.nonce != p.nonce || a.sampleCount < p.minSamples || a.priceYes > P) revert InvalidAttestation();
        if (a.windowStart <= p.armedAt || a.windowEnd != a.windowStart + p.window || a.windowEnd > block.timestamp) revert InvalidAttestation();
        bool atLower = p.lower != 0 && a.priceYes <= p.lower;
        if (!atLower && !(p.upper != P && a.priceYes >= p.upper)) revert InvalidAttestation();
        if (!SignatureChecker.isValidERC1271SignatureNow(p.resolver, _windowDigest(a), sigs)) revert InvalidAttestation();
        p.exitSide = atLower ? YES : NO; // the side knocked out
        p.exitSize = p.size;
        p.knock = true;
        p.requestTime = uint64(block.timestamp);
        p.nonce += 1;
        p.state = State.ExitRequested;
        emit KnockOutTriggered(a.potId, p.exitSide, a.priceYes, p.nonce, a.evidenceHash);
    }


}
