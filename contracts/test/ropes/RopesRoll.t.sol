// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RopesTestBase} from "./RopesTestBase.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";
import {HonorCatRopesExtra} from "../../src/ropes/HonorCatRopesExtra.sol";

/// @notice v2.1: the roll entry for perps (openFunded), the division record, no takeover when one holder
///         owns both sides, and the 2-point margin for posts.
contract RopesRollTest is RopesTestBase {
    address internal chain = makeAddr("chain"); // stands in for the perp chain contract
    HonorCatRopesExtra internal xr;

    function setUp() public override {
        super.setUp();
        xr = HonorCatRopesExtra(address(ropes));
        usdc.mint(chain, 1_000e6);
        vm.prank(chain);
        usdc.approve(address(ropes), type(uint256).max);
    }

    /// @dev A two-sided 10-point rope at 50 whose two sides `chain` holds (it creates and joins).
    function _chainRope() internal returns (uint256 id) {
        RopesBase.CreateParams memory c = _rope(YES, 1_000, 500_000, 0, 100_000, 100_000, uint64(block.timestamp + 6 hours));
        id = _createAs(chain, c);
        _joinAs(chain, id, 500_000);
    }

    function _depthFor(address who) internal view returns (RopesBase.DepthAttestation memory d, bytes memory sigs) {
        (d, sigs) = _depth(who, 10_000_000, 20_000, true);
    }

    /// @dev The next rope's terms around `entry` (tolerance 0, same market and signers).
    function _next(uint32 entry) internal view returns (RopesBase.CreateParams memory c) {
        c = _rope(YES, 1_000, entry, 0, 100_000, 100_000, uint64(block.timestamp + 6 hours));
    }

    function test_roll_opensTheNextRopeAtTheDivisionPrice() public {
        uint256 id = _chainRope();
        _knockOut(id, 390_000, 382_345); // division at 38.2345%, clamped to 40 for the payout
        (uint32 price, uint8 reason,, uint128 py, uint128 pn) = ropes.divisions(id);
        assertEq(price, 382_345);
        assertEq(reason, 1);
        assertEq(py + pn, 2_000_000);
        assertEq(py, 0);
        uint256 c0 = _bal(chain);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depthFor(chain);
        vm.prank(chain);
        uint256 next = xr.openFunded(_next(382_300), id, d, sigs);
        RopesBase.Pot memory p = ropes.pot(next);
        assertEq(uint8(p.state), uint8(RopesBase.State.Live));
        assertEq(p.entry, 382_300);
        assertEq(p.lower, 282_300);
        assertEq(p.upper, 482_300);
        assertEq(c0 - _bal(chain), 2_000_000); // both stakes, from the caller
        assertEq(ropes.ownerOf(next * 2), chain);
        assertEq(ropes.ownerOf(next * 2 + 1), chain);
        assertTrue(ropes.rolledFrom(id));
    }

    function test_roll_afterExpiryToo() public {
        uint256 id = _chainRope();
        (RopesBase.WindowAttestation memory a, bytes memory s) = _expiryAtt(id, 0, 560_000, true);
        ext.resolveExpiry(a, s);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depthFor(chain);
        closeTime = uint64(block.timestamp + 1 days); // the market is still open
        (d, sigs) = _depth(chain, 10_000_000, 20_000, true);
        RopesBase.CreateParams memory c = _next(560_000);
        vm.prank(chain);
        xr.openFunded(c, id, d, sigs);
    }

    function test_roll_rejections() public {
        uint256 id = _chainRope();
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depthFor(chain);
        // not divided yet
        vm.prank(chain);
        vm.expectRevert(RopesBase.WrongState.selector);
        xr.openFunded(_next(500_000), id, d, sigs);
        _knockOut(id, 390_000, 380_000);
        (d, sigs) = _depthFor(chain);
        // someone who does not hold both sides
        (RopesBase.DepthAttestation memory da, bytes memory sa) = _depthFor(alice);
        vm.prank(alice);
        vm.expectRevert(RopesBase.NotOwner.selector);
        xr.openFunded(_next(380_000), id, da, sa);
        // a different entry than the division price
        vm.prank(chain);
        vm.expectRevert(RopesBase.BadParams.selector);
        xr.openFunded(_next(400_000), id, d, sigs);
        // a depth attestation for someone else
        vm.prank(chain);
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        xr.openFunded(_next(380_000), id, da, sa);
        // a rope that breaks the rules (posts 30 points away: past the margin at the bottom)
        RopesBase.CreateParams memory bad = _rope(YES, 1_000, 380_000, 0, 370_000, 100_000, uint64(block.timestamp + 6 hours));
        vm.prank(chain);
        vm.expectRevert(RopesBase.BadParams.selector);
        xr.openFunded(bad, id, d, sigs);
        // once is enough
        vm.prank(chain);
        xr.openFunded(_next(380_000), id, d, sigs);
        (d, sigs) = _depthFor(chain);
        vm.prank(chain);
        vm.expectRevert(RopesBase.WrongState.selector);
        xr.openFunded(_next(380_000), id, d, sigs);
    }

    function test_roll_tooLate() public {
        uint256 id = _chainRope();
        _knockOut(id, 390_000, 380_000);
        vm.warp(block.timestamp + 15 minutes + 1);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depthFor(chain);
        vm.prank(chain);
        vm.expectRevert(RopesBase.WrongState.selector);
        xr.openFunded(_next(380_000), id, d, sigs);
    }

    function test_roll_notAfterAVoluntaryExit() public {
        uint256 id = _chainRope();
        _exit(id, chain, YES, 1_000, 450_000);
        (, uint8 reason,,,) = ropes.divisions(id);
        assertEq(reason, 0);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depthFor(chain);
        vm.prank(chain);
        vm.expectRevert(RopesBase.WrongState.selector);
        xr.openFunded(_next(450_000), id, d, sigs);
    }

    function test_noTakeoverWhenOneHolderHasBothSides() public {
        uint256 id = _chainRope();
        vm.prank(chain);
        ext.requestExit(id, NO, 1_000);
        vm.prank(carol);
        vm.expectRevert(RopesBase.WrongState.selector);
        ext.takeover(id, _noAuth());
    }

    function test_divisionRecordedOnSettlementAndDeadline() public {
        uint256 id = _create(_normal(YES, 500, 600_000, 0));
        _join(id, 600_000);
        uint256 id2 = _create(_normal(NO, 500, 300_000, 0));
        _join(id2, 300_000);
        vm.warp(closeTime);
        (RopesBase.OutcomeAttestation memory o, bytes memory s) = _outcome(id, 0);
        xr.settle(o, s);
        (uint32 price, uint8 reason,, uint128 py, uint128 pn) = ropes.divisions(id);
        assertEq(price, 0);
        assertEq(reason, 4);
        assertEq(py, 0);
        assertEq(pn, 5_000_000);
        vm.warp(ropes.pot(id2).deadline);
        xr.expire(id2);
        (price, reason,, py, pn) = ropes.divisions(id2);
        assertEq(reason, 5);
        assertEq(price, 300_000);
        assertEq(py, 1_500_000);
        assertEq(pn, 3_500_000);
    }

    function test_marginTwoPoints() public {
        // a YES post 1.99 points above 0 is refused, 2 points is fine
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth(alice, 10_000_000, 0, true);
        vm.prank(alice);
        vm.expectRevert(RopesBase.BadParams.selector);
        ropes.create(_rope(YES, 100, 119_900, 0, 100_000, 0, uint64(block.timestamp + 6 hours)), d, sigs, _noAuth());
        vm.prank(alice);
        ropes.create(_rope(YES, 100, 120_000, 0, 100_000, 0, uint64(block.timestamp + 6 hours)), d, sigs, _noAuth());
    }
}
