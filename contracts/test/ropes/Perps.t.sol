// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RopesTestBase} from "./RopesTestBase.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";
import {HonorCatPerps} from "../../src/HonorCatPerps.sol";
import {HonorCatRopes} from "../../src/HonorCatRopes.sol";

/// @notice The perp chain (HonorCatPerps) on top of HonorCatRopes v2.1, with real 2-of-3 signatures.
///         Stake per rope: posts 10 points either side, size 100 → $0.10 per side per rope.
contract PerpsTest is RopesTestBase {
    HonorCatPerps internal perps;
    uint256 internal constant S = 100_000; // 1,000 ticks × 100

    function setUp() public override {
        super.setUp();
        perps = new HonorCatPerps(HonorCatRopes(address(ropes)));
        address[4] memory who = [alice, bob, carol, dave];
        for (uint256 i; i < 4; ++i) {
            vm.prank(who[i]);
            usdc.approve(address(perps), type(uint256).max);
        }
    }

    function _terms(uint64 ropeLife) internal view returns (HonorCatPerps.Terms memory t) {
        t = HonorCatPerps.Terms({
            conditionId: COND,
            resolver: address(resolver),
            creatorSide: YES,
            d: 100_000,
            size: 100,
            ropeLife: ropeLife,
            closeTime: closeTime,
            grace: 1 days,
            window: 60,
            minSamples: 24,
            tolerance: 20_000
        });
    }

    function _perpDepth() internal view returns (RopesBase.DepthAttestation memory d, bytes memory sigs) {
        (d, sigs) = _depth(address(perps), 10_000_000, 20_000, true);
    }

    /// @dev alice (YES) with `livesA` stakes, bob (NO) with `livesB` stakes plus the maker treat; the first
    ///      rope priced at 50.
    function _running(uint256 livesA, uint256 livesB, uint64 ropeLife) internal returns (uint256 id) {
        vm.prank(alice);
        id = perps.open(_terms(ropeLife), livesA * S);
        vm.prank(bob);
        perps.join(id, livesB * S + S / 400);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _perpDepth();
        perps.startFirstRope(id, 500_000, d, sigs);
        (RopesBase.WindowAttestation memory a, bytes memory s) = _window(perps.perp(id).pot, 0, 500_000, true);
        ropes.resolveJoin(a, s);
        _advance(id);
        assertEq(uint8(perps.perp(id).phase), uint8(HonorCatPerps.Phase.Running));
    }

    function _advance(uint256 id) internal {
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _perpDepth();
        perps.advance(id, d, sigs);
    }

    function _pot(uint256 id) internal view returns (uint256) {
        return perps.perp(id).pot;
    }

    /// @dev Everything this contract and the pots hold equals what the players put in minus what they took.
    function _conserved(uint256 total0) internal view {
        assertEq(_bal(alice) + _bal(bob) + _bal(address(perps)) + _bal(address(ropes)), total0);
    }

    // ---------------------------------------------------------------- the chain

    function test_chain_knockOutExpiryAndRollEachWay() public {
        uint256 total0 = _bal(alice) + _bal(bob);
        uint256 id = _running(9, 9, 6 hours);
        // rope 1: knocked out at the lower post (YES loses its stake), rolls at the division price
        uint256 p1 = _pot(id);
        _knockOut(p1, 390_000, 385_000);
        _advance(id);
        HonorCatPerps.Perp memory q = perps.perp(id);
        assertEq(q.ropes, 2);
        RopesBase.Pot memory r2 = ropes.pot(q.pot);
        assertEq(r2.entry, 385_000); // the new rope is strung around the new price
        assertEq(r2.lower, 285_000);
        assertEq(r2.upper, 485_000);
        (uint256 la, uint256 lb) = perps.lives(id);
        assertEq(la, 7); // 9 − rope 1 lost − rope 2 staked (+ the 0.25 cent treat)
        assertEq(lb, 9); // 9 − rope 1 + 2 back − rope 2
        // rope 2: knocked out at the upper post (NO loses), rolls again
        _knockOut(q.pot, 490_000, 600_000);
        _advance(id);
        q = perps.perp(id);
        assertEq(q.ropes, 3);
        // rope 3: ends at its expiry at 49.0, rolls
        uint256 p3 = q.pot;
        (RopesBase.WindowAttestation memory a, bytes memory s) = _expiryAtt(p3, 0, 490_000, true);
        ext.resolveExpiry(a, s);
        _advance(id);
        q = perps.perp(id);
        assertEq(q.ropes, 4);
        assertEq(q.resultA + q.resultB, 0); // what one won, the other lost (no fees on knock-outs and expiries)
        _conserved(total0);
    }

    function test_chain_endsWhenAPlayerRunsOutOfLives() public {
        uint256 total0 = _bal(alice) + _bal(bob);
        uint256 id = _running(1, 5, 6 hours); // alice brings exactly one stake
        _knockOut(_pot(id), 390_000, 0); // a jump far past her post: she loses her stake, no more
        _advance(id);
        HonorCatPerps.Perp memory q = perps.perp(id);
        assertEq(uint8(q.phase), uint8(HonorCatPerps.Phase.Ended));
        assertEq(q.pot, 0);
        assertEq(q.freeA, S / 400); // only the maker treat she earned
        assertEq(q.resultA, -int256(S) + int256(S / 400));
        _conserved(total0);
        // everything left is free and can be withdrawn
        vm.prank(bob);
        perps.withdraw(id, q.freeB);
        vm.prank(alice);
        perps.withdraw(id, q.freeA);
        assertEq(_bal(address(perps)), 0);
        _conserved(total0);
    }

    function test_chain_leaveNowPaysTheFeeAndEnds() public {
        uint256 id = _running(3, 3, 6 hours);
        vm.prank(alice);
        perps.leaveNow(id);
        (RopesBase.WindowAttestation memory a, bytes memory s) = _window(_pot(id), 1, 550_000, true);
        ropes.resolveExit(a, s);
        _advance(id);
        HonorCatPerps.Perp memory q = perps.perp(id);
        assertEq(uint8(q.phase), uint8(HonorCatPerps.Phase.Ended));
        // YES at 55 with posts 40–60: 150,000 of a 200,000 rope, minus 1% of 200,000 to NO
        assertEq(q.resultA, int256(150_000 - 2_000) - int256(S) + int256(S / 400));
        assertEq(q.resultB, int256(50_000 + 2_000) - int256(S) - int256(S / 400));
    }

    function test_chain_stopRenewingRunsTheRopeToItsEnd() public {
        uint256 id = _running(3, 3, 6 hours);
        vm.prank(bob);
        perps.stopRenewing(id);
        (RopesBase.WindowAttestation memory a, bytes memory s) = _expiryAtt(_pot(id), 0, 520_000, true);
        ext.resolveExpiry(a, s);
        _advance(id);
        assertEq(uint8(perps.perp(id).phase), uint8(HonorCatPerps.Phase.Ended));
        assertEq(perps.perp(id).ropes, 1);
    }

    function test_chain_handshakeNeedsBothAndEnds() public {
        uint256 id = _running(3, 3, 6 hours);
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(alice);
        perps.agreeHandshake(id, 530_000, deadline);
        assertEq(uint8(ropes.pot(_pot(id)).state), uint8(RopesBase.State.Live)); // one approval is not enough
        vm.prank(bob);
        perps.agreeHandshake(id, 530_000, deadline);
        assertEq(uint8(ropes.pot(_pot(id)).state), uint8(RopesBase.State.Divided));
        _advance(id);
        HonorCatPerps.Perp memory q = perps.perp(id);
        assertEq(uint8(q.phase), uint8(HonorCatPerps.Phase.Ended));
        assertEq(q.resultA, int256(130_000) - int256(S) + int256(S / 400)); // no fee
    }

    function test_onlyFreeBalanceCanBeWithdrawn() public {
        uint256 id = _running(2, 2, 6 hours);
        HonorCatPerps.Perp memory q = perps.perp(id);
        vm.prank(alice);
        vm.expectRevert(HonorCatPerps.TooLittle.selector);
        perps.withdraw(id, q.freeA + 1); // the stake in the rope is not free
        vm.prank(alice);
        perps.withdraw(id, q.freeA);
        vm.prank(carol);
        vm.expectRevert(HonorCatPerps.NotPlayer.selector);
        perps.withdraw(id, 1);
        // having withdrawn everything, alice cannot be put on a new rope: the chain ends at the next roll
        _knockOut(_pot(id), 610_000, 650_000); // she wins this rope
        _advance(id);
        assertEq(perps.perp(id).ropes, 2); // she won 2 stakes: enough for another rope
        _knockOut(_pot(id), 390_000, 300_000); // and loses the next: 1 stake left, still rolls
        _advance(id);
        assertEq(perps.perp(id).ropes, 3);
    }

    function test_noRollWithoutAValidAttestation() public {
        uint256 id = _running(3, 3, 6 hours);
        // the rope has not ended: nothing to do
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _perpDepth();
        vm.expectRevert(HonorCatPerps.WrongPhase.selector);
        perps.advance(id, d, sigs);
        _knockOut(_pot(id), 390_000, 380_000);
        (d, sigs) = _perpDepth(); // a fresh one (they are valid for 60 s)
        // a depth attestation for someone else, or with one signature, does not roll and does not end
        (RopesBase.DepthAttestation memory da, bytes memory sa) = _depth(alice, 10_000_000, 20_000, true);
        vm.expectRevert(HonorCatPerps.BadParams.selector);
        perps.advance(id, da, sa);
        bytes memory one = _sig(sorted[0], ropes.depthDigest(d));
        vm.expectRevert(HonorCatPerps.BadParams.selector);
        perps.advance(id, d, one);
        assertEq(uint8(perps.perp(id).phase), uint8(HonorCatPerps.Phase.Running));
        perps.advance(id, d, sigs);
        assertEq(perps.perp(id).ropes, 2);
    }

    function test_chainEndsWhenTheMarketCannotCarryARope() public {
        // ropes of 6 hours on a market closing in 1 day: after enough time the next rope cannot open
        uint256 id = _running(5, 5, 6 hours);
        vm.warp(closeTime - 2 hours - 5 minutes); // less than 10 minutes of life left before the lead
        (RopesBase.WindowAttestation memory a, bytes memory s) = _knockAtt(_pot(id), 390_000);
        a; s; // a knock-out in the lock-out is refused, so end the rope at its expiry instead
        uint256 total0 = _bal(alice) + _bal(bob) + _bal(address(perps)) + _bal(address(ropes));
        (a, s) = _expiryAtt(_pot(id), 0, 470_000, true);
        ext.resolveExpiry(a, s);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth(address(perps), 10_000_000, 20_000, true);
        perps.advance(id, d, sigs);
        HonorCatPerps.Perp memory q = perps.perp(id);
        assertEq(uint8(q.phase), uint8(HonorCatPerps.Phase.Ended));
        assertEq(q.pot, 0);
        // credited, nothing staked: both stakes came back with the rope's result
        assertEq(_bal(alice) + _bal(bob) + _bal(address(perps)) + _bal(address(ropes)), total0);
        assertEq(_bal(address(perps)), q.freeA + q.freeB);
    }

    function test_firstJoinNotPricedReturnsBothStakes() public {
        vm.prank(alice);
        uint256 id = perps.open(_terms(6 hours), 3 * S);
        vm.prank(bob);
        perps.join(id, 3 * S + S / 400);
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _perpDepth();
        perps.startFirstRope(id, 500_000, d, sigs);
        (RopesBase.WindowAttestation memory a, bytes memory s) = _window(_pot(id), 0, 700_000, true); // outside the band
        ropes.resolveJoin(a, s);
        _advance(id);
        HonorCatPerps.Perp memory q = perps.perp(id);
        assertEq(uint8(q.phase), uint8(HonorCatPerps.Phase.Funded));
        assertEq(q.freeA, 3 * S);
        assertEq(q.freeB, 3 * S + S / 400);
        assertEq(_bal(address(perps)), 6 * S + S / 400);
    }

    function test_addLivesAndTheCreatorCanTakeAnOfferBack() public {
        vm.prank(alice);
        uint256 id = perps.open(_terms(6 hours), 2 * S);
        vm.prank(alice);
        perps.addLives(id, S);
        (uint256 la,) = perps.lives(id);
        assertEq(la, 3);
        vm.prank(alice);
        perps.withdraw(id, 3 * S);
        assertEq(uint8(perps.perp(id).phase), uint8(HonorCatPerps.Phase.Ended));
        vm.prank(bob);
        vm.expectRevert(HonorCatPerps.WrongPhase.selector);
        perps.join(id, 2 * S);
    }

    // ---------------------------------------------------------------- funds always add up

    /// @dev Random chains: each rope ends by knock-out (at a random post, jumps far past it included) or at
    ///      its expiry at a random price; random stop-renewing and withdrawals. After every step the
    ///      perp contract holds exactly the players' free balances, and nothing is created or lost.
    function testFuzz_fundsAddUpAcrossAChain(uint256 seed, uint8 livesA, uint8 livesB) public {
        uint256 total0 = _bal(alice) + _bal(bob);
        uint256 id = _running(bound(livesA, 1, 6), bound(livesB, 1, 6), 6 hours);
        for (uint256 i; i < 8; ++i) {
            HonorCatPerps.Perp memory q = perps.perp(id);
            if (q.phase != HonorCatPerps.Phase.Running) break;
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            RopesBase.Pot memory p = ropes.pot(q.pot);
            if (r % 5 == 0) {
                (RopesBase.WindowAttestation memory a, bytes memory s) = _expiryAtt(q.pot, 0, uint32(bound(r >> 8, 0, 1_000_000)), true);
                ext.resolveExpiry(a, s);
            } else if (r % 2 == 0) {
                _knockOut(q.pot, p.lower, uint32(bound(r >> 8, 0, p.lower))); // at or far below the lower post
            } else {
                _knockOut(q.pot, p.upper, uint32(bound(r >> 8, p.upper, 1_000_000)));
            }
            if ((r >> 40) % 7 == 0) {
                vm.prank(bob);
                perps.stopRenewing(id);
            }
            _advance(id);
            q = perps.perp(id);
            assertEq(q.resultA + q.resultB, 0);
            if (q.phase == HonorCatPerps.Phase.Running) {
                assertGe(q.freeA + 0, 0);
                RopesBase.Pot memory np = ropes.pot(q.pot);
                assertEq(np.lower + 100_000, np.entry);
                assertEq(np.entry + 100_000, np.upper);
            }
            assertEq(_bal(address(perps)), q.freeA + q.freeB);
            _conserved(total0);
        }
    }
}
