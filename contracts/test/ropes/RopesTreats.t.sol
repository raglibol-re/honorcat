// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RopesTestBase} from "./RopesTestBase.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";

/// @notice Treats: every reward is a share of a fee someone paid. Maker treat, exit fee, referral share,
///         copycat treat, and the properties that keep them from being farmed.
contract RopesTreatsTest is RopesTestBase {
    function _total4() internal view returns (uint256) {
        return _bal(alice) + _bal(bob) + _bal(carol) + _bal(dave) + _bal(address(ropes));
    }

    // ---------------------------------------------------------------- maker treat and referral

    function test_makerTreat_withJoinersReferrer() public {
        vm.prank(bob);
        ext.setReferrer(carol);
        uint256 id = _create(_stdRope(YES));
        uint256 a0 = _bal(alice);
        uint256 c0 = _bal(carol);
        vm.prank(bob);
        ropes.requestJoin(id, 0, _noAuth());
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _window(id, 0, 500_000, true);
        vm.expectEmit(true, true, true, true, address(ropes));
        emit RopesBase.ReferralTreat(id, bob, carol, 2_500);
        vm.expectEmit(true, true, true, true, address(ropes));
        emit RopesBase.MakerTreat(id, bob, alice, 10_000);
        ropes.resolveJoin(a, sigs);
        assertEq(_bal(alice) - a0, 10_000); // 80% of 0.25% of $5
        assertEq(_bal(carol) - c0, 2_500); // 20% to bob's referrer
    }

    function test_referrer_onceBeforeFirstPotNeverSelf() public {
        vm.prank(bob);
        vm.expectRevert(RopesBase.BadReferrer.selector);
        ext.setReferrer(bob);
        vm.prank(bob);
        vm.expectRevert(RopesBase.BadReferrer.selector);
        ext.setReferrer(address(0));
        vm.prank(bob);
        ext.setReferrer(carol);
        vm.prank(bob);
        vm.expectRevert(RopesBase.BadReferrer.selector);
        ext.setReferrer(dave); // only once
        _create(_normal(YES, 100, 500_000, 0)); // alice's first pot
        vm.prank(alice);
        vm.expectRevert(RopesBase.BadReferrer.selector);
        ext.setReferrer(dave); // too late: alice already has a pot
        assertEq(ext.referrerOf(bob), carol);
    }

    function test_referral_firstTwentyPotsOnly() public {
        vm.prank(bob);
        ext.setReferrer(carol);
        uint256 c0 = _bal(carol);
        for (uint256 i; i < 21; ++i) {
            uint256 id = _create(_normal(YES, 100, 500_000, 0));
            _join(id, 500_000); // bob's deposit $0.50, maker treat 1,250, referral 250
        }
        assertEq(_bal(carol) - c0, 20 * 250);
        assertEq(ext.potCount(bob), 21);
    }

    function test_exitFee_withExitersReferrer() public {
        vm.prank(alice);
        ext.setReferrer(dave);
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        uint256 b0 = _bal(bob);
        uint256 d0 = _bal(dave);
        vm.prank(alice);
        ext.requestExit(id, YES, 1_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 600_000, true);
        vm.expectEmit(true, true, true, true, address(ropes));
        emit RopesBase.ReferralTreat(id, alice, dave, 12_000);
        vm.expectEmit(true, true, true, true, address(ropes));
        emit RopesBase.ExitFee(id, alice, bob, 48_000);
        ropes.resolveExit(a, sigs);
        // fee 1% of 6.00 = 0.06: 0.012 to dave, 0.048 to bob on top of NO's 4.00
        assertEq(_bal(dave) - d0, 12_000);
        assertEq(_bal(bob) - b0, 4_000_000 + 48_000);
    }

    function test_noFeeOnKnockOutOrExpiry() public {
        vm.prank(alice);
        ext.setReferrer(dave);
        uint256 id = _create(_stdRope(YES));
        _join(id, 500_000);
        uint256 d0 = _bal(dave);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(id, 0, 650_000, true);
        ropes.resolveExpiry(a, sigs);
        assertEq(_bal(dave), d0);
    }

    /// @dev An account that refers its own second account gets back part of its own fees, never more:
    ///      together the two accounts are poorer by 80% of every fee paid.
    function test_sybilReferralGainsNothingBeyondOwnFees() public {
        address alt = makeAddr("alice-alt");
        usdc.mint(alt, 100e6);
        vm.prank(alt);
        usdc.approve(address(ropes), type(uint256).max);
        vm.prank(alt);
        ext.setReferrer(alice);
        uint256 id = _createAs(alt, _stdRope(YES));
        _join(id, 500_000); // bob joins, pays alt the maker treat
        uint256 pair0 = _bal(alice) + _bal(alt);
        vm.prank(alt);
        ext.requestExit(id, YES, 1_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 500_000, true);
        ropes.resolveExit(a, sigs);
        uint256 fee = 60_000;
        // alt receives its 1.00 minus the fee, alice gets 20% of the fee back
        assertEq(_bal(alice) + _bal(alt), pair0 + 1_000_000 - fee + fee / 5);
        assertLt(_bal(alice) + _bal(alt), pair0 + 1_000_000); // strictly worse than paying no fee
    }

    // ---------------------------------------------------------------- copycat

    /// @dev pot 1: alice YES, bob NO (the leader's pot). pot 2: carol copies alice's YES side; dave is NO.
    function _copySetup() internal returns (uint256 lead, uint256 copy) {
        lead = _create(_stdRope(YES));
        _join(lead, 500_000);
        RopesBase.CreateParams memory c = _stdRope(YES);
        c.copyOf = ext.tokenOf(lead, YES);
        copy = _createAs(carol, c);
        _joinAs(dave, copy, 500_000);
        (address leader,,,) = ext.copies(ext.tokenOf(copy, YES));
        assertEq(leader, alice);
    }

    function test_copycat_treatOnProfit() public {
        (, uint256 copy) = _copySetup();
        uint256 a0 = _bal(alice);
        uint256 c0 = _bal(carol);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(copy, 0, 700_000, true);
        vm.expectEmit(true, true, true, true, address(ropes));
        emit RopesBase.CopycatTreat(copy, carol, alice, 100_000, 2_000_000);
        ropes.resolveExpiry(a, sigs);
        // carol's cash 3.00 on a 1.00 deposit: profit 2.00, treat 5% = 0.10 to alice
        assertEq(_bal(alice) - a0, 100_000);
        assertEq(_bal(carol) - c0, 3_000_000 - 100_000);
        assertEq(_bal(address(ropes)), 6_000_000); // only the leader's own pot is left
    }

    function test_copycat_noProfitNoTreat() public {
        (, uint256 copy) = _copySetup();
        uint256 a0 = _bal(alice);
        uint256 c0 = _bal(carol);
        _knockOut(copy, 400_000, 450_000);
        assertEq(_bal(alice), a0);
        assertEq(_bal(carol) - c0, 500_000); // the full cash: the hold-back comes back
    }

    function test_copycat_profitThenLossNoTreat() public {
        (, uint256 copy) = _copySetup();
        uint256 a0 = _bal(alice);
        uint256 c0 = _bal(carol);
        _exit(copy, carol, YES, 500, 500_000); // cash 0.50 − fee 0.03 = 0.47, 5% held for now
        _knockOut(copy, 390_000, 0); // the rest is lost: overall carol lost money
        assertEq(_bal(alice), a0);
        assertEq(_bal(carol) - c0, 470_000);
    }

    function test_copycat_joinerCopy_makerTreatCountsAsCost() public {
        uint256 lead = _create(_stdRope(NO)); // alice NO, bob YES
        _join(lead, 500_000);
        uint256 copy = _createAs(dave, _stdRope(YES)); // dave YES; carol joins NO copying alice
        uint256 leadNo = ext.tokenOf(lead, NO);
        vm.prank(carol);
        ropes.requestJoin(copy, leadNo, _noAuth());
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _window(copy, 0, 500_000, true);
        ropes.resolveJoin(a, sigs);
        (address leader, uint256 paidIn,,) = ext.copies(ext.tokenOf(copy, NO));
        assertEq(leader, alice);
        assertEq(paidIn, 5_000_000 + 12_500); // deposit plus the maker treat carol paid
        uint256 a0 = _bal(alice);
        _knockOut(copy, 390_000, 0); // NO (carol) wins the whole 6.00
        // profit 6.00 − 5.0125 = 0.9875; 5% = 0.049375
        assertEq(_bal(alice) - a0, 49_375);
    }

    function test_copycat_tenureEndsOnTransfer() public {
        (, uint256 copy) = _copySetup();
        uint256 t = ext.tokenOf(copy, YES);
        vm.prank(carol);
        ropes.transferFrom(carol, bob, t);
        (address leader,,,) = ext.copies(t);
        assertEq(leader, address(0));
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(copy, 0, 700_000, true);
        ropes.resolveExpiry(a, sigs);
        assertEq(_bal(alice), a0); // bob never copied anyone
        assertEq(_bal(bob) - b0, 3_000_000);
    }

    function test_copycat_badCopies() public {
        uint256 lead = _create(_stdRope(YES));
        _join(lead, 500_000);
        RopesBase.CreateParams memory c = _stdRope(YES);
        // copying yourself
        c.copyOf = ext.tokenOf(lead, YES);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 10_000_000, 20_000, true);
        vm.prank(alice);
        vm.expectRevert(RopesBase.BadCopy.selector);
        ropes.create(c, d, sigs, _noAuth());
        // a side that does not exist
        c.copyOf = 999;
        (d, sigs) = _depth(carol, 10_000_000, 20_000, true);
        vm.prank(carol);
        vm.expectRevert(RopesBase.BadCopy.selector);
        ropes.create(c, d, sigs, _noAuth());
    }

    function test_copycat_treatSharedWithCopiersReferrer() public {
        vm.prank(carol);
        ext.setReferrer(bob);
        (, uint256 copy) = _copySetup();
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(copy, 0, 700_000, true);
        ropes.resolveExpiry(a, sigs);
        assertEq(_bal(alice) - a0, 80_000);
        assertEq(_bal(bob) - b0, 20_000);
    }

    // ---------------------------------------------------------------- conservation

    /// @dev Everything that leaves equals everything that came in: deposits, lives and fees in; payouts
    ///      and treats out. Nothing is created and nothing is kept.
    function test_conservation_allTreatsAndPayouts() public {
        vm.prank(bob);
        ext.setReferrer(carol);
        vm.prank(dave);
        ext.setReferrer(alice);
        uint256 total0 = _total4();
        (uint256 lead, uint256 copy) = _copySetup();
        vm.prank(alice);
        ext.addLife(lead, YES, _noAuth());
        _exit(lead, bob, NO, 300, 520_000);
        _knockOut(lead, 290_000, 100_000);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(copy, 0, 820_000, true);
        ropes.resolveExpiry(a, sigs);
        assertEq(_bal(address(ropes)), 0);
        assertEq(_total4(), total0);
        assertEq(ropes.totalClaimable(), 0);
    }
}
