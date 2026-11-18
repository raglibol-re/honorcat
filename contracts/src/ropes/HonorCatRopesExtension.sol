// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {RopesBase} from "./RopesBase.sol";

/// @title  HonorCatRopesExtension
/// @notice The rest of HonorCat v2's functions. HonorCatRopes runs this code by delegatecall on its own
///         storage, so every call below acts on the pots held at the HonorCatRopes address. Calling this
///         contract directly only touches its own empty storage and moves no money.
contract HonorCatRopesExtension is RopesBase {
    using SafeERC20 for IERC20;

    /// @notice HonorCatRopesExtra (views, settlement, roll), run on HonorCatRopes' storage by delegatecall.
    address public immutable views;

    constructor(IERC20 usdc_, address views_) RopesBase(usdc_, address(1)) {
        if (views_.code.length == 0) revert BadParams();
        views = views_;
    }

    /// @dev Anything not defined here is in HonorCatRopesExtra, run on the same storage.
    fallback() external {
        address v = views;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), v, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    // ---------------------------------------------------------------- admin (new pots only; no fees, no funds)

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice The testnet maximum for a pot's value. It applies to new pots and to extra lives.
    function setGlobalMaxPot(uint256 max) external onlyOwner {
        globalMaxPot = max;
        emit GlobalMaxPotSet(max);
    }

    // ---------------------------------------------------------------- referral

    /// @notice Records the caller's referrer: once, before the caller's first pot, never itself.
    function setReferrer(address ref) external {
        if (ref == address(0) || ref == msg.sender || referrerOf[msg.sender] != address(0) || potCount[msg.sender] != 0) revert BadReferrer();
        referrerOf[msg.sender] = ref;
        emit ReferrerSet(msg.sender, ref);
    }

    // ---------------------------------------------------------------- open offers

    /// @notice Withdraws an offer nobody has joined: the creator any time, anyone after the pot's end.
    function cancel(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.Open) revert WrongState();
        if (msg.sender != ownerOf(_tokenOf(potId, p.creatorSide)) && block.timestamp < _end(p)) revert NotOwner();
        _refundEscrowsAndExpire(potId, p);
    }

    /// @notice A join whose window never got an attestation in time can be abandoned by anyone.
    function abandonJoin(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.Joining) revert WrongState();
        if (block.timestamp <= p.requestTime + DELAY + p.window + ATTEST_TIMEOUT) revert TooEarly();
        uint8 joinSide = 1 - p.creatorSide;
        uint256 refund = joinSide == YES ? p.escrowYes : p.escrowNo;
        if (joinSide == YES) p.escrowYes = 0;
        else p.escrowNo = 0;
        address joiner = p.joiner;
        p.joiner = address(0);
        p.joinerLeader = address(0);
        p.state = State.Open;
        emit JoinFailed(potId, p.nonce, bytes32(0));
        _pay(potId, joiner, refund);
    }

    // ---------------------------------------------------------------- extra lives

    /// @notice Moves `side`'s own post one original distance further out (never past 0 or 100), paid by
    ///         the side's owner. The other side's share at every price stays the same or grows, so this
    ///         never reduces the other side's claim. Not while a window is open, nor in the lock-out.
    function addLife(uint256 potId, uint8 side, Authorization calldata auth) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.Live) revert WrongState();
        _beforeLockout(p);
        uint256 tokenId = _tokenOf(potId, side);
        address payer = _payer(auth);
        if (side > NO || payer != ownerOf(tokenId)) revert NotOwner();
        uint256 cost;
        uint8 lives;
        if (side == YES) {
            if (p.distYes == 0 || p.lower == 0 || p.livesYes >= MAX_LIVES) revert NoMoreLives();
            uint256 newL = p.lower > p.distYes ? p.lower - p.distYes : 0;
            cost = (p.lower / TICK - newL / TICK) * p.size;
            p.lower = uint32(newL);
            lives = ++p.livesYes;
        } else {
            if (p.distNo == 0 || p.upper == P || p.livesNo >= MAX_LIVES) revert NoMoreLives();
            uint256 newU = uint256(p.upper) + p.distNo < P ? uint256(p.upper) + p.distNo : P;
            cost = (newU / TICK - p.upper / TICK) * p.size;
            p.upper = uint32(newU);
            lives = ++p.livesNo;
        }
        if (_total(p) > globalMaxPot) revert AboveCap();
        p.armedAt = uint64(block.timestamp); // a knock-out window must start after the posts moved
        p.nonce += 1; // and an attestation made against the old posts can no longer be used
        Copy storage cp = copies[tokenId];
        if (cp.leader != address(0)) cp.paidIn += cost;
        _pull(payer, cost, keccak256(abi.encode("life", potId, side, lives)), auth);
        emit ExtraLife(potId, side, lives, p.lower, p.upper, cost);
    }

    // ---------------------------------------------------------------- exits that did not get a price

    /// @notice Files a binding exit request for `side` (the caller owns that side's token).
    function requestExit(uint256 potId, uint8 side, uint256 size) external {
        if (msg.sender != ownerOf(_tokenOf(potId, side))) revert NotOwner();
        _requestExit(potId, side, size);
    }

    /// @notice Same, authorised by the side owner's EIP-712 signature (EOA or ERC-1271), submitted by anyone.
    function requestExitFor(uint256 potId, uint8 side, uint256 size, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert ExpiredSignature();
        uint256 tokenId = _tokenOf(potId, side);
        if (!SignatureChecker.isValidSignatureNow(ownerOf(tokenId), _exitRequestDigest(potId, side, size, deadline), sig)) revert NotOwner();
        sigNonce[tokenId] += 1;
        _requestExit(potId, side, size);
    }

    /// @notice An exit or knock-out window that got no attestation in time can be abandoned by anyone.
    function abandonExit(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.ExitRequested) revert WrongState();
        if (block.timestamp <= p.requestTime + DELAY + p.window + ATTEST_TIMEOUT) revert TooEarly();
        _exitFailed(potId, p, bytes32(0));
    }

    // ---------------------------------------------------------------- expiry

    /// @notice Divides a short rope at its expiry. The window is fixed by the expiry and the attempt number,
    ///         priced forward and clamped, no fee. An invalid window moves on to the next fixed one.
    function resolveExpiry(WindowAttestation calldata a, bytes calldata sigs) external nonReentrant {
        Pot storage p = _pots[a.potId];
        if (p.state != State.Live || p.expiry == 0 || p.expiryTry >= EXPIRY_TRIES) revert WrongState();
        uint64 start = _expiryStart(p, p.expiryTry);
        if (a.kind != KIND_EXPIRY || a.nonce != p.nonce || a.windowStart != start || a.windowEnd != start + p.window) revert InvalidAttestation();
        if (a.windowEnd > block.timestamp) revert TooEarly();
        if (a.priceYes > P || (a.valid && a.sampleCount < p.minSamples)) revert InvalidAttestation();
        if (!SignatureChecker.isValidERC1271SignatureNow(p.resolver, _windowDigest(a), sigs)) revert InvalidAttestation();
        if (!a.valid) {
            emit ExpiryWindowFailed(a.potId, p.expiryTry, a.evidenceHash);
            p.expiryTry += 1;
            return;
        }
        _divide(a.potId, p, YES, p.size, a.priceYes, false, R_EXPIRY, a.evidenceHash);
    }

    /// @notice An expiry window that got no attestation in time is skipped; the next fixed one applies.
    function skipExpiryWindow(uint256 potId) external {
        Pot storage p = _pots[potId];
        if (p.state != State.Live || p.expiry == 0 || p.expiryTry >= EXPIRY_TRIES) revert WrongState();
        if (block.timestamp <= _expiryStart(p, p.expiryTry) + p.window + ATTEST_TIMEOUT) revert TooEarly();
        emit ExpiryWindowFailed(potId, p.expiryTry, bytes32(0));
        p.expiryTry += 1;
    }

    // ---------------------------------------------------------------- takeover

    /// @notice While a full voluntary exit window is open, a third party may take the exiting side's
    ///         place by escrowing the whole pot value. Settled at the forward exit price; first wins.
    function takeover(uint256 potId, Authorization calldata auth) external nonReentrant {
        Pot storage p = _pots[potId];
        if (p.state != State.ExitRequested || p.knock || p.joiner != address(0) || p.exitSize != p.size) revert WrongState();
        if (block.timestamp >= p.requestTime + DELAY + p.window) revert TooLate();
        // A pot whose two sides one holder owns (a perp chain) is not open to takeovers.
        if (ownerOf(_tokenOf(potId, YES)) == ownerOf(_tokenOf(potId, NO))) revert WrongState();
        address taker = _payer(auth);
        p.joiner = taker;
        _pull(taker, _total(p), keccak256(abi.encode("takeover", potId, taker, p.nonce)), auth);
        emit TakeoverOffered(potId, taker, p.nonce);
    }

    // ---------------------------------------------------------------- nets and bowls

    function setLevels(uint256 potId, uint8 side, uint32 net, uint32 bowl) external {
        uint256 tokenId = _tokenOf(potId, side);
        if (msg.sender != ownerOf(tokenId)) revert NotOwner();
        if (net > P || bowl > P || (net != 0 && bowl != 0 && net >= bowl)) revert BadParams();
        levels[tokenId] = Levels(net, bowl, uint64(block.timestamp));
        emit LevelsSet(potId, side, net, bowl);
    }

    function triggerLevel(WindowAttestation calldata a, bytes calldata sigs) external {
        Pot storage p = _pots[a.potId];
        if (p.state != State.Live) revert WrongState();
        if (a.kind < KIND_NET || a.kind > KIND_BOWL + 1) revert InvalidAttestation();
        uint8 side = (a.kind - KIND_NET) % 2;
        bool isNet = a.kind < KIND_BOWL;
        Levels memory l = levels[_tokenOf(a.potId, side)];
        uint32 level = isNet ? l.net : l.bowl;
        if (level == 0 || !a.valid || a.nonce != p.nonce || a.sampleCount < p.minSamples) revert InvalidAttestation();
        if (a.windowStart <= l.setAt || a.windowEnd != a.windowStart + p.window || a.windowEnd > block.timestamp) revert InvalidAttestation();
        if (a.priceYes > P || !SignatureChecker.isValidERC1271SignatureNow(p.resolver, _windowDigest(a), sigs)) revert InvalidAttestation();
        uint256 own = side == YES ? a.priceYes : P - a.priceYes;
        if (isNet ? own > level : own < level) revert InvalidAttestation();
        emit LevelTriggered(a.potId, side, a.kind, a.priceYes, a.evidenceHash);
        _requestExit(a.potId, side, p.size);
    }

    // ---------------------------------------------------------------- handshake

    /// @notice Both owners agree to divide `size` at `priceYes` (clamped to the posts), at once and without
    ///         a fee. Signatures (EOA or ERC-1271) bind the pot's current nonce.
    function handshake(uint256 potId, uint32 priceYes, uint256 size, uint256 deadline, bytes calldata sigYes, bytes calldata sigNo)
        external
        nonReentrant
    {
        Pot storage p = _pots[potId];
        if (p.state != State.Live) revert WrongState();
        if (block.timestamp > deadline) revert ExpiredSignature();
        if (block.timestamp >= p.closeTime) revert TooLate();
        if (priceYes > P || size == 0 || size > p.size) revert BadParams();
        bytes32 digest = _handshakeDigest(potId, priceYes, size, deadline);
        if (
            !SignatureChecker.isValidSignatureNow(ownerOf(_tokenOf(potId, YES)), digest, sigYes)
                || !SignatureChecker.isValidSignatureNow(ownerOf(_tokenOf(potId, NO)), digest, sigNo)
        ) revert NotOwner();
        p.nonce += 1;
        emit Handshake(potId, priceYes, size);
        _divide(potId, p, YES, size, priceYes, false, R_HANDSHAKE, bytes32(0));
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
}
