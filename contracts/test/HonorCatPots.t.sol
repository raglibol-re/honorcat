// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HonorCatPots} from "../src/HonorCatPots.sol";
import {PotsBase} from "./PotsBase.sol";

/// @notice D1 step 1, core: create, forward-priced join, exit, settle, expire.
contract HonorCatPotsCoreTest is PotsBase {
    uint256 constant N = 10e6; // $10

    // ---------------------------------------------------------------- create

    function test_create_escrowsWorstCaseOfBand() public {
        uint256 before = _bal(alice);
        uint256 id = _create(0, N, 600_000, 20_000); // YES at 60% ± 2 points
        assertEq(before - _bal(alice), 6_200_000); // yesPart(10, 0.62)
        assertEq(pots.ownerOf(pots.tokenOf(id, 0)), alice);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Open));
    }

    function test_create_noSideEscrowsLowEndOfBand() public {
        uint256 before = _bal(alice);
        _create(1, N, 600_000, 20_000); // NO pays most when YES is lowest: 1 − 0.58
        assertEq(before - _bal(alice), 4_200_000);
    }

    function test_create_rejectsBadParams() public {
        (HonorCatPots.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 100_000);
        HonorCatPots.CreateParams memory c = _params(0, N, 600_000, 60_000); // tolerance above 5 points
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.BadParams.selector);
        pots.create(c, d, sigs, _noAuth());
        c = _params(0, 26e6, 600_000, 20_000); // above the $25 maximum
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.BadParams.selector);
        pots.create(c, d, sigs, _noAuth());
        c = _params(0, N, 600_000, 20_000);
        c.grace = 12 hours; // below one day
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.BadParams.selector);
        pots.create(c, d, sigs, _noAuth());
    }

    function test_create_refusedWhenPausedButEverythingElseWorks() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        _join(id, 600_000);
        pots.setPaused(true);
        (HonorCatPots.DepthAttestation memory d, bytes memory dsig) = _depth(alice, 100_000);
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.PausedForNewPots.selector);
        pots.create(_params(0, N, 600_000, 20_000), d, dsig, _noAuth());
        // An existing pot can still exit.
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 600_000, true);
        pots.resolveExit(a, sigs);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Divided));
    }

    function test_create_tooCloseToTradingClose() public {
        closeTime = uint64(block.timestamp + 100);
        HonorCatPots.CreateParams memory c = _params(0, N, 600_000, 20_000);
        (HonorCatPots.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 100_000);
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.TooLate.selector);
        pots.create(c, d, sigs, _noAuth());
    }

    // ---------------------------------------------------------------- join (forward-priced)

    function test_join_entersAtWindowPriceAndRefundsBothSides() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        _join(id, 590_000); // entry 59%
        HonorCatPots.Pot memory p = pots.pot(id);
        assertEq(p.depYes, 5_900_000);
        assertEq(p.depNo, 4_100_000);
        assertEq(uint8(p.state), uint8(HonorCatPots.State.Live));
        // Alice escrowed 6.2 and is refunded 0.3; Bob escrowed 4.2 and is refunded 0.1.
        assertEq(_bal(alice) - a0, 300_000);
        assertEq(b0 - _bal(bob), 4_100_000);
        assertEq(_bal(address(pots)), N);
        assertEq(pots.ownerOf(pots.tokenOf(id, 1)), bob);
    }

    function test_join_outsideBandFailsAndOfferStaysOpen() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        uint256 b0 = _bal(bob);
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 0, 650_000, true);
        pots.resolveJoin(a, sigs);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Open));
        assertEq(_bal(bob), b0); // refunded in full
    }

    function test_join_invalidWindowFails() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 0, 600_000, false);
        pots.resolveJoin(a, sigs);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Open));
    }

    function test_join_windowFixedByRequest() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a,) = _window(id, 0, 600_000, true);
        a.windowStart += 5; // a window the signers chose themselves
        a.windowEnd += 5;
        vm.warp(a.windowEnd);
        bytes memory sigs = _sign2(pots.windowDigest(a));
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveJoin(a, sigs);
    }

    function test_join_cannotResolveBeforeWindowEnds() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        HonorCatPots.Pot memory p = pots.pot(id);
        HonorCatPots.WindowAttestation memory a = HonorCatPots.WindowAttestation(id, 0, p.nonce, p.requestTime + 1, p.requestTime + 61, 30, 600_000, true, bytes32(0));
        bytes memory sigs = _sign2(pots.windowDigest(a));
        vm.expectRevert(HonorCatPots.TooEarly.selector);
        pots.resolveJoin(a, sigs);
    }

    function test_join_abandonAfterTimeout() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        uint256 b0 = _bal(bob);
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        vm.expectRevert(HonorCatPots.TooEarly.selector);
        pots.abandonJoin(id);
        vm.warp(block.timestamp + 1 + 60 + 10 minutes + 1);
        pots.abandonJoin(id);
        assertEq(_bal(bob), b0);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Open));
    }

    function test_cancel_creatorAnytimeOthersAfterClose() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        vm.prank(bob);
        vm.expectRevert(HonorCatPots.NotOwner.selector);
        pots.cancel(id);
        uint256 a0 = _bal(alice);
        vm.prank(alice);
        pots.cancel(id);
        assertEq(_bal(alice) - a0, 6_200_000);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Expired));
    }

    // ---------------------------------------------------------------- attestation checks

    function test_attestation_rejectsSingleSignerOutsiderAndReplay() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 0, 600_000, true);
        bytes32 d = pots.windowDigest(a);
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveJoin(a, _sig(sorted[0], d)); // one signer
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveJoin(a, bytes.concat(_sig(sorted[0], d), _sig(0xBAD, d))); // outsider
        pots.resolveJoin(a, sigs);
        vm.expectRevert(HonorCatPots.WrongState.selector);
        pots.resolveJoin(a, sigs); // replay
    }

    function test_attestation_tooFewSamplesRejected() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a,) = _window(id, 0, 600_000, true);
        a.sampleCount = 10;
        bytes memory sigs = _sign2(pots.windowDigest(a));
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveJoin(a, sigs);
    }

    // ---------------------------------------------------------------- exit

    function _live() internal returns (uint256 id) {
        id = _create(0, N, 600_000, 20_000);
        _join(id, 600_000); // depYes 6, depNo 4
    }

    function test_exit_dividesAtForwardPriceWithFee() public {
        uint256 id = _live();
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 700_000, true);
        pots.resolveExit(a, sigs);
        // YES share at 70% = 7.00; fee 1% of 10 = 0.10 to NO.
        assertEq(_bal(alice) - a0, 6_900_000);
        assertEq(_bal(bob) - b0, 3_100_000);
        assertEq(_bal(address(pots)), 0);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Divided));
    }

    function test_exit_isBindingAndOneAtATime() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        vm.prank(bob);
        vm.expectRevert(HonorCatPots.WrongState.selector);
        pots.requestExit(id, 1, N);
    }

    function test_exit_onlyOwner() public {
        uint256 id = _live();
        vm.prank(carol);
        vm.expectRevert(HonorCatPots.NotOwner.selector);
        pots.requestExit(id, 0, N);
    }

    function test_exit_bySignatureGasless() public {
        uint256 pk = 0xA11CE;
        address signerOwner = vm.addr(pk);
        uint256 id = _live();
        uint256 tokenYes = pots.tokenOf(id, 0);
        vm.prank(alice);
        pots.transferFrom(alice, signerOwner, tokenYes);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sig(pk, pots.exitRequestDigest(id, 0, N, deadline));
        vm.prank(carol); // anyone submits
        pots.requestExitFor(id, 0, N, deadline, sig);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.ExitRequested));
        vm.expectRevert(); // nonce used
        pots.requestExitFor(id, 0, N, deadline, sig);
    }

    function test_exit_failedWindowContinuesWithCooldown() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 0, false);
        pots.resolveExit(a, sigs);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Live));
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.Cooldown.selector);
        pots.requestExit(id, 0, N);
        vm.warp(block.timestamp + 2 minutes);
        vm.prank(alice);
        pots.requestExit(id, 0, N);
    }

    function test_exit_refusedInLockout() public {
        uint256 id = _live();
        vm.warp(closeTime - 2 minutes);
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.TooLate.selector);
        pots.requestExit(id, 0, N);
    }

    function test_exit_tokenLockedDuringWindow() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        uint256 tokenYes = pots.tokenOf(id, 0);
        uint256 tokenNo = pots.tokenOf(id, 1);
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.WrongState.selector);
        pots.transferFrom(alice, carol, tokenYes);
        // The other side's token still moves.
        vm.prank(bob);
        pots.transferFrom(bob, carol, tokenNo);
    }

    function test_exit_abandonAfterTimeout() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        vm.warp(block.timestamp + 1 + 60 + 10 minutes + 1);
        pots.abandonExit(id);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Live));
    }

    function test_exit_feeNeverExceedsShare() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 0, true); // YES worth 0
        uint256 b0 = _bal(bob);
        pots.resolveExit(a, sigs);
        assertEq(_bal(bob) - b0, N);
    }

    // ---------------------------------------------------------------- settle / expire

    function test_settle_winnerTakesPot() public {
        uint256 id = _live();
        vm.warp(closeTime);
        (HonorCatPots.OutcomeAttestation memory o, bytes memory sigs) = _outcome(id, 0); // NO
        uint256 b0 = _bal(bob);
        pots.settle(o, sigs);
        assertEq(_bal(bob) - b0, N);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Settled));
    }

    function test_settle_voidReturnsDeposits() public {
        uint256 id = _live();
        vm.warp(closeTime);
        (HonorCatPots.OutcomeAttestation memory o, bytes memory sigs) = _outcome(id, 2);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        pots.settle(o, sigs);
        assertEq(_bal(alice) - a0, 6e6);
        assertEq(_bal(bob) - b0, 4e6);
    }

    function test_settle_notBeforeCloseAndWrongCondition() public {
        uint256 id = _live();
        (HonorCatPots.OutcomeAttestation memory o, bytes memory sigs) = _outcome(id, 1);
        vm.expectRevert(HonorCatPots.TooEarly.selector);
        pots.settle(o, sigs);
        vm.warp(closeTime);
        o.conditionId = keccak256("other");
        sigs = _sign2(pots.outcomeDigest(o));
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.settle(o, sigs);
    }

    function test_settle_dropsPendingExit() public {
        uint256 id = _live();
        vm.warp(closeTime - 1 days + 1 hours);
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        vm.warp(closeTime);
        (HonorCatPots.OutcomeAttestation memory o, bytes memory sigs) = _outcome(id, 1);
        uint256 a0 = _bal(alice);
        pots.settle(o, sigs);
        assertEq(_bal(alice) - a0, N);
    }

    function test_expire_afterDeadlineReturnsDeposits() public {
        uint256 id = _live();
        vm.warp(closeTime + 3 days - 1);
        vm.expectRevert(HonorCatPots.TooEarly.selector);
        pots.expire(id);
        vm.warp(closeTime + 3 days);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        pots.expire(id);
        assertEq(_bal(alice) - a0, 6e6);
        assertEq(_bal(bob) - b0, 4e6);
        assertEq(_bal(address(pots)), 0);
    }

    function test_expire_joiningReturnsBothEscrows() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        vm.warp(closeTime + 3 days);
        pots.expire(id);
        assertEq(_bal(alice) - a0, 6_200_000);
        assertEq(_bal(bob) - b0, 4_200_000);
        assertEq(_bal(address(pots)), 0);
    }

    // ---------------------------------------------------------------- blocked recipients

    function test_blockedRecipientGetsClaimable() public {
        uint256 id = _live();
        usdc.setBlocked(bob, true);
        vm.warp(closeTime);
        (HonorCatPots.OutcomeAttestation memory o, bytes memory sigs) = _outcome(id, 0);
        pots.settle(o, sigs);
        assertEq(pots.claimable(bob), N);
        usdc.setBlocked(bob, false);
        vm.prank(bob);
        pots.withdraw();
        assertEq(pots.claimable(bob), 0);
    }

    // ---------------------------------------------------------------- gasless deposits (EIP-3009)

    function test_create_withAuthorizationBoundToAction() public {
        uint256 pk = 0xC0FFEE;
        address user = vm.addr(pk);
        usdc.mint(user, 100e6);
        HonorCatPots.CreateParams memory c = _params(0, N, 600_000, 20_000);
        bytes32 salt = keccak256("salt");
        bytes32 action = keccak256(abi.encode("create", user, c));
        bytes32 nonce = pots.depositNonce(action, salt);
        uint256 amount = 6_200_000;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdc.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), user, address(pots), amount, 0, block.timestamp + 1 hours, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        HonorCatPots.Authorization memory auth = HonorCatPots.Authorization(user, 0, block.timestamp + 1 hours, salt, v, r, s);
        (HonorCatPots.DepthAttestation memory d, bytes memory dsig) = _depth(user, 100_000);
        vm.prank(carol); // a relayer submits; the user pays no gas
        uint256 id = pots.create(c, d, dsig, auth);
        assertEq(pots.ownerOf(pots.tokenOf(id, 0)), user);
        // The same authorization cannot be redirected to different parameters.
        c.notional = 20e6;
        vm.prank(carol);
        vm.expectRevert();
        pots.create(c, d, dsig, auth);
    }

    // ---------------------------------------------------------------- cap (step 2)

    function test_cap_quarterOfContractsNearThePrice() public {
        // 2,000 hundredths = 20 contracts within 5 cents -> cap $5.
        (HonorCatPots.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 2_000);
        assertEq(pots.capFor(2_000), 5e6);
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.AboveCap.selector);
        pots.create(_params(0, 5_000_001, 600_000, 20_000), d, sigs, _noAuth());
        vm.prank(alice);
        pots.create(_params(0, 5e6, 600_000, 20_000), d, sigs, _noAuth());
    }

    function test_cap_attestationBoundToCreatorMarketCloseAndTime() public {
        (HonorCatPots.DepthAttestation memory d, bytes memory sigs) = _depth(bob, 100_000);
        vm.prank(alice); // someone else's attestation
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.create(_params(0, N, 600_000, 20_000), d, sigs, _noAuth());
        (d, sigs) = _depth(alice, 100_000);
        HonorCatPots.CreateParams memory c = _params(0, N, 600_000, 20_000);
        c.closeTime += 1 hours; // a close the signers did not attest
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.create(c, d, sigs, _noAuth());
        vm.warp(block.timestamp + 61); // stale
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.create(_params(0, N, 600_000, 20_000), d, sigs, _noAuth());
    }

    function test_cap_needsTheSignerSet() public {
        HonorCatPots.DepthAttestation memory d = HonorCatPots.DepthAttestation(COND, alice, 100_000, closeTime, uint64(block.timestamp + 60));
        bytes memory one = _sig(sorted[0], pots.depthDigest(d));
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.create(_params(0, N, 600_000, 20_000), d, one, _noAuth());
    }
}
