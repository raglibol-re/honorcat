// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RopesTestBase} from "./RopesTestBase.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";

/// @notice Unit tests of HonorCat v2: posts, deposits, knock-out, expiry, extra lives, settlement and the
///         features carried over from v1, with real 2-of-3 signatures.
contract RopesTest is RopesTestBase {
    // ---------------------------------------------------------------- normal pots keep today's behaviour

    function test_normalPot_joinExitFee() public {
        uint256 id = _create(_normal(YES, 1_000, 600_000, 20_000)); // 10 contracts, pot $10
        assertEq(ropes.pot(id).escrowYes, 6_200 * 1_000); // worst case at 62
        _join(id, 610_000);
        RopesBase.Pot memory p = ropes.pot(id);
        assertEq(p.lower, 0);
        assertEq(p.upper, P);
        assertEq(p.expiry, 0);
        // full exit by YES at 70: YES gets 7.00 − 1% of 10.00, NO 3.00 + 0.10
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        _exit(id, alice, YES, 1_000, 700_000);
        assertEq(_bal(alice) - a0, 7_000_000 - 100_000);
        assertEq(_bal(bob) - b0, 3_000_000 + 100_000);
        assertEq(uint8(_state(id)), uint8(RopesBase.State.Divided));
        assertEq(_bal(address(ropes)), 0);
    }

    function test_normalPot_runsToSettlement() public {
        uint256 id = _create(_normal(NO, 500, 300_000, 0));
        _join(id, 300_000);
        vm.warp(closeTime);
        (RopesBase.OutcomeAttestation memory o, bytes memory s) = _outcome(id, 1);
        uint256 b0 = _bal(bob);
        ext.settle(o, s);
        assertEq(_bal(bob) - b0, 10_000 * 500); // YES (bob) gets the whole pot
    }

    // ---------------------------------------------------------------- posts and deposits

    function test_rope_postsDepositsAndMakerTreat() public {
        uint256 id = _create(_stdRope(YES));
        assertEq(ropes.pot(id).escrowYes, 1_000_000); // exactly the distance: $1
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        _join(id, 500_000);
        RopesBase.Pot memory p = ropes.pot(id);
        assertEq(p.lower, 400_000);
        assertEq(p.upper, P);
        assertEq(p.entry, 500_000);
        assertEq(_bal(address(ropes)), 6_000_000); // the pot: (100 − 40) points × 10 contracts
        assertEq(_bal(alice) - a0, 12_500); // maker treat: 0.25% of bob's $5 deposit
        assertEq(b0 - _bal(bob), 5_000_000 + 12_500);
        (uint256 y, uint256 n) = ext.shares(id, 500_000);
        assertEq(y, 1_000_000);
        assertEq(n, 5_000_000);
    }

    function test_rope_postsFollowTheEntry() public {
        RopesBase.CreateParams memory c = _rope(YES, 1_000, 500_000, 20_000, 100_000, 0, uint64(block.timestamp + 6 hours));
        uint256 id = _create(c);
        _join(id, 512_345); // entry snaps to 51.23
        RopesBase.Pot memory p = ropes.pot(id);
        assertEq(p.entry, 512_300);
        assertEq(p.lower, 412_300);
        (uint256 y, uint256 n) = ext.shares(id, p.entry);
        assertEq(y, 1_000_000); // YES's deposit is exactly its distance whatever the entry
        assertEq(n, (10_000 - 5_123) * 1_000);
        assertEq(_bal(address(ropes)), y + n);
    }

    function test_rope_leverageShown() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        RopesBase.Pot memory p = ropes.pot(id);
        assertEq(uint256(p.entry) / (p.entry - p.lower), 5); // YES 5×
        assertEq((P - p.entry) / (p.upper - p.entry), 1); // NO 1×
    }

    // ---------------------------------------------------------------- creation limits

    function _expectCreate(RopesBase.CreateParams memory c, uint32 spread, bool crypto, bytes4 err) internal {
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 10_000_000, spread, crypto);
        vm.prank(alice);
        vm.expectRevert(err);
        ropes.create(c, d, sigs, _noAuth());
    }

    function test_create_minDistance() public {
        uint64 x = uint64(block.timestamp + 6 hours);
        _expectCreate(_rope(YES, 100, 500_000, 0, 40_000, 0, x), 10_000, true, RopesBase.BadParams.selector); // < 5 points
        _expectCreate(_rope(YES, 100, 500_000, 0, 50_000, 0, x), 30_000, true, RopesBase.BadParams.selector); // < 2 × 3-point spread
        _expectCreate(_rope(YES, 100, 500_000, 0, 0, 40_000, x), 10_000, true, RopesBase.BadParams.selector); // NO post too
    }

    function test_create_maxLeverage() public {
        uint64 x = uint64(block.timestamp + 6 hours);
        // 10× at 50 with a 5-point post: allowed on crypto, refused elsewhere (5×)
        _expectCreate(_rope(YES, 100, 500_000, 0, 50_000, 0, x), 10_000, false, RopesBase.BadParams.selector);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 10_000_000, 10_000, true);
        vm.prank(alice);
        ropes.create(_rope(YES, 100, 500_000, 0, 50_000, 0, x), d, sigs, _noAuth());
        // 11× (55 / 5) refused even on crypto, counting the top of the band
        _expectCreate(_rope(YES, 100, 500_000, 50_000, 50_000, 0, x), 10_000, true, RopesBase.BadParams.selector);
        // NO side: (100 − 50) / 5 = 10× fine on crypto, 5× elsewhere
        _expectCreate(_rope(NO, 100, 500_000, 0, 0, 50_000, x), 10_000, false, RopesBase.BadParams.selector);
    }

    function test_create_postsInsideTheRange() public {
        uint64 x = uint64(block.timestamp + 6 hours);
        _expectCreate(_rope(YES, 100, 100_000, 0, 100_000, 0, x), 0, true, RopesBase.BadParams.selector); // L would be 0
        _expectCreate(_rope(NO, 100, 900_000, 0, 0, 100_000, x), 0, true, RopesBase.BadParams.selector); // U would be 100
        _expectCreate(_rope(YES, 100, 500_000, 0, 100_050, 0, x), 0, true, RopesBase.BadParams.selector); // off the tick grid
    }

    function test_create_expiryRules() public {
        uint64 t = uint64(block.timestamp);
        _expectCreate(_rope(YES, 100, 500_000, 0, 100_000, 0, 0), 0, true, RopesBase.BadParams.selector); // rope without expiry
        _expectCreate(_rope(YES, 100, 500_000, 0, 100_000, 0, t + 9 minutes), 0, true, RopesBase.BadParams.selector); // < 10 min
        _expectCreate(_rope(YES, 100, 500_000, 0, 100_000, 0, closeTime - 2 hours + 1), 0, true, RopesBase.BadParams.selector); // < 2 h before close
    }

    function test_create_expiryRules_extra() public {
        // a normal pot may not carry an expiry
        RopesBase.CreateParams memory c = _normal(YES, 100, 500_000, 0);
        c.expiry = uint64(block.timestamp + 1 hours);
        _expectCreate(c, 0, true, RopesBase.BadParams.selector);
        // more than 7 days of life
        closeTime = uint64(block.timestamp + 30 days);
        _expectCreate(_rope(YES, 100, 500_000, 0, 100_000, 0, uint64(block.timestamp + 7 days + 1)), 0, true, RopesBase.BadParams.selector);
        // exactly at the limits is fine
        _createAs(alice, _rope(YES, 100, 500_000, 0, 100_000, 0, uint64(block.timestamp + 7 days)));
        closeTime = uint64(block.timestamp + 1 days);
        _createAs(alice, _rope(YES, 100, 500_000, 0, 100_000, 0, closeTime - 2 hours));
        _createAs(alice, _rope(YES, 100, 500_000, 0, 100_000, 0, uint64(block.timestamp + 10 minutes)));
    }

    function test_cap_rejectsTooLarge() public {
        RopesBase.CreateParams memory c = _stdRope(YES); // size 1,000 needs 4,000 hundredths near the price
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 3_999, 0, true);
        vm.prank(alice);
        vm.expectRevert(RopesBase.AboveCap.selector);
        ropes.create(c, d, sigs, _noAuth());
        (d, sigs) = _depth(alice, 4_000, 0, true);
        vm.prank(alice);
        ropes.create(c, d, sigs, _noAuth());
    }

    function test_cap_testnetMaximum() public {
        // a normal pot of 2,501 hundredths could hold $25.01
        _expectCreate(_normal(YES, 2_501, 500_000, 0), 0, true, RopesBase.AboveCap.selector);
        _create(_normal(YES, 2_500, 500_000, 0));
    }

    // ---------------------------------------------------------------- knock-out

    function test_knockOut_jumpPastPostPaysClamped() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        _knockOut(id, 390_000, 0); // the window average jumped to 0: far beyond the post at 40
        assertEq(_bal(alice), a0); // YES loses exactly its deposit, nothing more
        assertEq(_bal(bob) - b0, 6_000_000); // NO gets the pot, no fee
        assertEq(uint8(_state(id)), uint8(RopesBase.State.Divided));
        assertEq(_bal(address(ropes)), 0);
    }

    function test_knockOut_backInsideDividesThereAndEnds() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        uint256 a0 = _bal(alice);
        _knockOut(id, 400_000, 430_000); // trigger at the post, the forward window came back to 43
        assertEq(_bal(alice) - a0, 300_000); // (43 − 40) × 10 contracts, no fee
        assertEq(uint8(_state(id)), uint8(RopesBase.State.Divided));
    }

    function test_knockOut_upperPost() public {
        RopesBase.CreateParams memory c = _rope(NO, 1_000, 500_000, 0, 0, 100_000, uint64(block.timestamp + 6 hours));
        uint256 id = _create(c);
        _join(id, 500_000); // bob is YES, alice NO with U = 60
        uint256 b0 = _bal(bob);
        _knockOut(id, 600_000, 990_000);
        assertEq(_bal(bob) - b0, 6_000_000); // YES gets all of a pot of 60 points
    }

    function test_knockOut_needsValidAttestation() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _knockAtt(id, 390_000);
        // one signer only
        bytes memory one = _sig(sorted[0], ropes.windowDigest(a));
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(a, one);
        // the price did not reach the post
        RopesBase.WindowAttestation memory b = _clone(a);
        b.priceYes = 400_100;
        bytes memory sb = _sign2(ropes.windowDigest(b));
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(b, sb);
        // valid = false
        b = _clone(a);
        b.valid = false;
        sb = _sign2(ropes.windowDigest(b));
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(b, sb);
        // wrong kind (an exit window)
        b = _clone(a);
        b.kind = 1;
        sb = _sign2(ropes.windowDigest(b));
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(b, sb);
        // a quote (kind 6) can never move money
        b.kind = 6;
        sb = _sign2(ropes.windowDigest(b));
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(b, sb);
        // a window that started before the posts were set
        b = _clone(a);
        b.windowStart = ropes.pot(id).armedAt;
        b.windowEnd = b.windowStart + 60;
        sb = _sign2(ropes.windowDigest(b));
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(b, sb);
        // the real one works
        ropes.triggerKnockOut(a, sigs);
        assertTrue(ropes.pot(id).knock);
    }

    function _clone(RopesBase.WindowAttestation memory a) internal pure returns (RopesBase.WindowAttestation memory) {
        return abi.decode(abi.encode(a), (RopesBase.WindowAttestation));
    }

    function test_knockOut_notDuringAnOpenWindow() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.prank(bob);
        ext.requestExit(id, NO, 500);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _knockAtt(id, 390_000);
        vm.expectRevert(RopesBase.WrongState.selector);
        ropes.triggerKnockOut(a, sigs);
    }

    function test_knockOut_notInTheLockout() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.warp(ropes.pot(id).expiry - 3 minutes);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _knockAtt(id, 390_000); // ends 61 s later, inside 121 s
        vm.expectRevert(RopesBase.TooLate.selector);
        ropes.triggerKnockOut(a, sigs);
    }

    function test_knockOut_notOnNormalPots() public {
        uint256 id = _create(_normal(YES, 100, 500_000, 0));
        _join(id, 500_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _knockAtt(id, 0);
        vm.expectRevert(RopesBase.WrongState.selector);
        ropes.triggerKnockOut(a, sigs);
    }

    function test_knockOut_failedWindowPotContinues() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _knockAtt(id, 390_000);
        ropes.triggerKnockOut(a, sigs);
        (a, sigs) = _window(id, 1, 0, false);
        ropes.resolveExit(a, sigs);
        assertEq(uint8(_state(id)), uint8(RopesBase.State.Live));
        assertFalse(ropes.pot(id).knock);
        assertEq(_bal(address(ropes)), 6_000_000);
    }

    function test_knockOut_noTakeover() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _knockAtt(id, 390_000);
        ropes.triggerKnockOut(a, sigs);
        vm.prank(carol);
        vm.expectRevert(RopesBase.WrongState.selector);
        ext.takeover(id, _noAuth());
    }

    // ---------------------------------------------------------------- expiry

    function test_expiry_dividesAtClampedForwardPrice() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.warp(ropes.pot(id).expiry);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(id, 0, 570_000, true);
        ropes.resolveExpiry(a, sigs);
        assertEq(_bal(alice) - a0, 1_700_000); // (57 − 40) × 10, no fee
        assertEq(_bal(bob) - b0, 4_300_000);
        assertEq(uint8(_state(id)), uint8(RopesBase.State.Divided));
    }

    function test_expiry_windowFixedByTheExpiry() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        RopesBase.Pot memory p = ropes.pot(id);
        vm.warp(p.expiry + 2 hours);
        // a window the submitter picked (ten minutes later) is refused
        RopesBase.WindowAttestation memory a = _att(id, 8, p.nonce, p.expiry + 601, 60, 900_000, true);
        bytes memory sigs = _sign2(ropes.windowDigest(a));
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.resolveExpiry(a, sigs);
        // and retry windows cannot be used before the earlier one failed
        (a, sigs) = _expiryAtt(id, 1, 900_000, true);
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.resolveExpiry(a, sigs);
    }

    function test_expiry_notBeforeTheWindowEnds() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        RopesBase.Pot memory p = ropes.pot(id);
        RopesBase.WindowAttestation memory a = _att(id, 8, p.nonce, p.expiry + 1, 60, 500_000, true);
        bytes memory sigs = _sign2(ropes.windowDigest(a));
        vm.warp(p.expiry + 30);
        vm.expectRevert(RopesBase.TooEarly.selector);
        ropes.resolveExpiry(a, sigs);
    }

    function test_expiry_cannotBeSkipped() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.warp(ropes.pot(id).expiry - 1 minutes);
        // nothing can start or move in the lock-out or after the expiry
        vm.prank(alice);
        vm.expectRevert(RopesBase.TooLate.selector);
        ext.requestExit(id, YES, 1_000);
        vm.prank(alice);
        vm.expectRevert(RopesBase.TooLate.selector);
        ext.addLife(id, YES, _noAuth());
        vm.warp(ropes.pot(id).expiry + 1 hours);
        vm.prank(bob);
        vm.expectRevert(RopesBase.TooLate.selector);
        ext.requestExit(id, NO, 1_000);
        // and settlement waits for trading close and all expiry windows
        (RopesBase.OutcomeAttestation memory o, bytes memory s) = _outcome(id, 1);
        vm.expectRevert(RopesBase.TooEarly.selector);
        ext.settle(o, s);
    }

    function test_expiry_invalidWindowMovesToTheNext() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(id, 0, 0, false);
        ropes.resolveExpiry(a, sigs);
        assertEq(ropes.pot(id).expiryTry, 1);
        // the failed window cannot be reused, the next fixed one prices it
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.resolveExpiry(a, sigs);
        (a, sigs) = _expiryAtt(id, 1, 450_000, true);
        uint256 a0 = _bal(alice);
        ropes.resolveExpiry(a, sigs);
        assertEq(_bal(alice) - a0, 500_000);
    }

    function test_expiry_skipAfterTimeout() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        uint64 start = ext.expiryWindowStart(id, 0);
        vm.warp(start + 60 + 10 minutes);
        vm.expectRevert(RopesBase.TooEarly.selector);
        ext.skipExpiryWindow(id);
        vm.warp(start + 60 + 10 minutes + 1);
        ext.skipExpiryWindow(id);
        assertEq(ropes.pot(id).expiryTry, 1);
    }

    function test_expiry_allWindowsFailThenSettlementClamped() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        for (uint8 i; i < 4; ++i) {
            (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(id, i, 0, false);
            ropes.resolveExpiry(a, sigs);
        }
        (RopesBase.WindowAttestation memory a2, bytes memory s2) = _expiryAtt(id, 3, 0, true);
        vm.expectRevert(RopesBase.WrongState.selector);
        ropes.resolveExpiry(a2, s2);
        vm.warp(closeTime);
        (RopesBase.OutcomeAttestation memory o, bytes memory s) = _outcome(id, 0); // NO: price 0, clamped to 40
        uint256 b0 = _bal(bob);
        ext.settle(o, s);
        assertEq(_bal(bob) - b0, 6_000_000);
        assertEq(_bal(address(ropes)), 0);
    }

    function test_settle_yesOnRopeClampsToThePot() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        for (uint8 i; i < 4; ++i) {
            vm.warp(ext.expiryWindowStart(id, i) + 60 + 10 minutes + 1);
            ext.skipExpiryWindow(id);
        }
        vm.warp(closeTime);
        (RopesBase.OutcomeAttestation memory o, bytes memory s) = _outcome(id, 1);
        uint256 a0 = _bal(alice);
        ext.settle(o, s);
        assertEq(_bal(alice) - a0, 6_000_000); // YES at 100 gets everything; no debt for NO
    }

    function test_settle_voidReturnsDeposits() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.prank(alice);
        ext.addLife(id, YES, _noAuth()); // deposits now 2.00 and 5.00
        vm.warp(closeTime);
        (RopesBase.OutcomeAttestation memory o, bytes memory s) = _outcome(id, 2);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        ext.settle(o, s);
        assertEq(_bal(alice) - a0, 2_000_000);
        assertEq(_bal(bob) - b0, 5_000_000);
    }

    function test_deadline_returnsDeposits() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.warp(ropes.pot(id).deadline);
        uint256 a0 = _bal(alice);
        ext.expire(id);
        assertEq(_bal(alice) - a0, 1_000_000);
        assertEq(_bal(address(ropes)), 0);
    }

    // ---------------------------------------------------------------- extra lives

    function test_extraLife_movesOwnPostAndKeepsTheOtherClaim() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        uint256[5] memory prices = [uint256(0), 350_000, 420_000, 650_000, P];
        uint256[5] memory noBefore;
        for (uint256 i; i < 5; ++i) (, noBefore[i]) = ext.shares(id, uint32(prices[i]));
        uint256 a0 = _bal(alice);
        vm.prank(alice);
        ext.addLife(id, YES, _noAuth());
        assertEq(a0 - _bal(alice), 1_000_000); // one more rope length: 10 points × 10 contracts
        RopesBase.Pot memory p = ropes.pot(id);
        assertEq(p.lower, 300_000);
        assertEq(p.livesYes, 1);
        for (uint256 i; i < 5; ++i) {
            (, uint256 noAfter) = ext.shares(id, uint32(prices[i]));
            assertGe(noAfter, noBefore[i]);
        }
        assertEq(_bal(address(ropes)), 7_000_000);
    }

    function test_extraLife_upToEightThenNoMore() public {
        RopesBase.CreateParams memory c = _rope(YES, 100, 900_000, 0, 100_000, 0, uint64(block.timestamp + 6 hours));
        uint256 id = _create(c);
        _join(id, 900_000); // L = 80: lives to 70, 60, ..., 0 would be 8 steps
        for (uint256 i; i < 8; ++i) {
            vm.prank(alice);
            ext.addLife(id, YES, _noAuth());
        }
        assertEq(ropes.pot(id).lower, 0);
        vm.prank(alice);
        vm.expectRevert(RopesBase.NoMoreLives.selector);
        ext.addLife(id, YES, _noAuth());
    }

    function test_extraLife_stopsAtZero() public {
        RopesBase.CreateParams memory c = _rope(YES, 100, 150_000, 0, 100_000, 0, uint64(block.timestamp + 6 hours));
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 10_000_000, 0, false);
        vm.prank(alice);
        uint256 id = ropes.create(c, d, sigs, _noAuth());
        _join(id, 150_000); // L = 5
        vm.prank(alice);
        ext.addLife(id, YES, _noAuth());
        assertEq(ropes.pot(id).lower, 0); // only 5 points left, charged for 5
        vm.prank(alice);
        vm.expectRevert(RopesBase.NoMoreLives.selector);
        ext.addLife(id, YES, _noAuth());
    }

    function test_extraLife_onlyOwnSideAndNotDuringAWindow() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.prank(bob);
        vm.expectRevert(RopesBase.NotOwner.selector);
        ext.addLife(id, YES, _noAuth());
        vm.prank(bob);
        vm.expectRevert(RopesBase.NoMoreLives.selector); // NO has no post on this rope
        ext.addLife(id, NO, _noAuth());
        vm.prank(bob);
        ext.requestExit(id, NO, 100);
        vm.prank(alice);
        vm.expectRevert(RopesBase.WrongState.selector);
        ext.addLife(id, YES, _noAuth());
    }

    function test_extraLife_oldKnockAttestationDies() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _knockAtt(id, 395_000);
        vm.prank(alice);
        ext.addLife(id, YES, _noAuth()); // L moves to 30; 39.5 is no longer at the post anyway
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(a, sigs);
    }

    // ---------------------------------------------------------------- carried over

    function test_partialExitOnRope_feeOnPotValueExited() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        _exit(id, alice, YES, 500, 450_000);
        // exited pot value 60 points × 5 contracts = 3.00; YES cash (45 − 40) × 5 = 0.25; fee 1% of 3.00
        assertEq(_bal(alice) - a0, 250_000 - 30_000);
        assertEq(_bal(bob) - b0, 2_750_000 + 30_000);
        assertEq(ropes.pot(id).size, 500);
        assertEq(_bal(address(ropes)), 3_000_000);
    }

    function test_takeoverOnRope() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.prank(bob);
        ext.requestExit(id, NO, 1_000);
        uint256 c0 = _bal(carol);
        vm.prank(carol);
        ext.takeover(id, _noAuth());
        assertEq(c0 - _bal(carol), 6_000_000); // escrows the whole pot value
        uint256 b0 = _bal(bob);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 450_000, true);
        ropes.resolveExit(a, sigs);
        // NO's cash at 45: 6.00 − 0.50 = 5.50; fee 0.06
        assertEq(_bal(bob) - b0, 5_500_000 - 60_000);
        assertEq(c0 - _bal(carol), 5_500_000);
        assertEq(ropes.ownerOf(ext.tokenOf(id, NO)), carol);
        assertEq(uint8(_state(id)), uint8(RopesBase.State.Live));
    }

    function test_handshakeOnRope_clamped() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        // both agree on 0 (below the post): YES gets 0, never less
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 d = ext.handshakeDigest(id, 0, 1_000, deadline);
        uint256 alicePk = uint256(keccak256("alice-key"));
        uint256 bobPk = uint256(keccak256("bob-key"));
        address a2 = vm.addr(alicePk);
        address b2 = vm.addr(bobPk);
        uint256 ty = ext.tokenOf(id, YES);
        uint256 tn = ext.tokenOf(id, NO);
        vm.prank(alice);
        ropes.transferFrom(alice, a2, ty);
        vm.prank(bob);
        ropes.transferFrom(bob, b2, tn);
        d = ext.handshakeDigest(id, 0, 1_000, deadline);
        ext.handshake(id, 0, 1_000, deadline, _sig(alicePk, d), _sig(bobPk, d));
        assertEq(_bal(a2), 0);
        assertEq(_bal(b2), 6_000_000);
    }

    function test_netOnRopeSide() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        vm.prank(alice);
        ext.setLevels(id, YES, 450_000, 0);
        RopesBase.Pot memory p = ropes.pot(id);
        vm.warp(block.timestamp + 5);
        RopesBase.WindowAttestation memory a = _att(id, 2, p.nonce, uint64(block.timestamp + 1), 60, 440_000, true);
        vm.warp(a.windowEnd);
        ext.triggerLevel(a, _sign2(ropes.windowDigest(a)));
        assertEq(uint8(_state(id)), uint8(RopesBase.State.ExitRequested));
    }

    function test_positionsTransferable() public {
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        uint256 ty = ext.tokenOf(id, YES);
        vm.prank(alice);
        ropes.transferFrom(alice, carol, ty);
        uint256 c0 = _bal(carol);
        _knockOut(id, 390_000, 450_000);
        assertEq(_bal(carol) - c0, 500_000);
    }

    function test_extensionDirectCallMovesNothing() public {
        // calling the extension's own address touches its empty storage only
        HonorCatRopesExtensionLike impl = HonorCatRopesExtensionLike(ropes.extension());
        vm.expectRevert();
        impl.expire(1);
    }

    function test_noOperatorFee() public view {
        assertEq(ropes.OPERATOR_FEE_BPS(), 0);
        assertEq(ropes.EXIT_FEE_BPS(), 100);
        assertEq(ropes.MAKER_TREAT_BPS(), 25);
        assertEq(ropes.REFERRAL_SHARE_BPS(), 2_000);
        assertEq(ropes.REFERRAL_POTS(), 20);
        assertEq(ropes.COPYCAT_BPS(), 500);
    }
}

interface HonorCatRopesExtensionLike {
    function expire(uint256 potId) external;
}
