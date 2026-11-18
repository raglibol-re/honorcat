// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RopesTestBase} from "./RopesTestBase.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";

/// @notice Fuzz tests: payouts sum to the pot at every price (jumps far beyond a post included), the
///         clamp, the 1% fee bound, extra lives never reducing the other claim, and random sequences of
///         partial exits and lives that always pay out exactly what came in.
contract RopesFuzzTest is RopesTestBase {
    function _grid(uint256 x) internal pure returns (uint256) {
        return (x / 100) * 100;
    }

    /// @dev The division arithmetic for any posts, size, price and side.
    function testFuzz_divideMath_sumsAndFeeBound(uint8 side, uint256 size, uint32 price, uint256 lower, uint256 upper, bool withFee) public view {
        side = side % 2;
        size = bound(size, 1, 1e15);
        lower = _grid(bound(lower, 0, P - 100));
        upper = _grid(bound(upper, lower + 100, P));
        price = uint32(bound(price, 0, P));
        (uint256 y, uint256 n, uint256 fee) = ext.divideMath(side, size, price, withFee, lower, upper);
        uint256 total = ext.potValue(size, lower, upper);
        assertEq(y + n, total);
        assertLe(fee * 100, total); // never more than 1% of the pot value exited
        if (!withFee) assertEq(fee, 0);
    }

    /// @dev The clamp: at or past a post a side has all or nothing, never beyond.
    function testFuzz_clamp(uint256 size, uint32 price, uint256 lower, uint256 upper) public view {
        size = bound(size, 1, 1e15);
        lower = _grid(bound(lower, 0, P - 100));
        upper = _grid(bound(upper, lower + 100, P));
        price = uint32(bound(price, 0, P));
        uint256 y = ext.yesShare(size, price, lower, upper);
        uint256 total = ext.potValue(size, lower, upper);
        assertLe(y, total);
        if (price <= lower) assertEq(y, 0);
        if (price >= upper) assertEq(y, total);
        if (price < P) assertLe(y, ext.yesShare(size, price + 1, lower, upper)); // monotonic
    }

    /// @dev A rope with fuzzed post distance and entry, knocked out by a jump to any price beyond the
    ///      lower post: YES loses exactly its deposit, NO gets exactly the pot, nothing is left.
    function testFuzz_jumpPastPost(uint32 dist, uint32 entry, uint32 jump) public {
        dist = uint32(_grid(bound(dist, 50_000, 300_000)));
        entry = uint32(bound(entry, uint256(dist) + 100, P - 100));
        if (entry > 10 * uint256(dist)) entry = uint32(10 * uint256(dist));
        uint256 id = _create(_rope(YES, 100, entry, 0, dist, 0, uint64(block.timestamp + 6 hours)));
        _join(id, entry);
        RopesBase.Pot memory p = ropes.pot(id);
        jump = uint32(bound(jump, 0, p.lower));
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        _knockOut(id, p.lower, jump);
        assertEq(_bal(alice), a0);
        assertEq(_bal(bob) - b0, (P - p.lower) / 100 * 100);
        assertEq(_bal(address(ropes)), 0);
    }

    /// @dev An extra life never reduces the other side's share at any price.
    function testFuzz_extraLifeKeepsOtherClaim(uint32 price, uint8 lives, bool noSide) public {
        lives = uint8(bound(lives, 1, 8));
        RopesBase.CreateParams memory c = noSide
            ? _rope(NO, 100, 100_000, 0, 0, 100_000, uint64(block.timestamp + 6 hours))
            : _rope(YES, 100, 900_000, 0, 100_000, 0, uint64(block.timestamp + 6 hours));
        uint256 id = _create(c);
        _join(id, c.bandCenter);
        price = uint32(bound(price, 0, P));
        uint8 side = noSide ? NO : YES;
        for (uint256 i; i < lives; ++i) {
            (uint256 y0, uint256 n0) = ext.shares(id, price);
            vm.prank(alice);
            ext.addLife(id, side, _noAuth());
            (uint256 y1, uint256 n1) = ext.shares(id, price);
            if (side == YES) assertGe(n1, n0);
            else assertGe(y1, y0);
        }
    }

    /// @dev Random partial exits and extra lives, then a knock-out or expiry at any price: the contract ends
    ///      empty and the two players together hold exactly what they started with.
    function testFuzz_sequence(uint256 seed, uint32 finalPrice, bool byExpiry) public {
        uint256 start = _bal(alice) + _bal(bob);
        uint256 id = _create(_rope(YES, 1_000, 500_000, 20_000, 100_000, 0, uint64(block.timestamp + 6 hours)));
        _join(id, uint32(bound(seed, 480_000, 520_000)));
        for (uint256 i; i < 5; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            RopesBase.Pot memory p = ropes.pot(id);
            if (p.size == 0) break;
            if (r % 3 == 0 && p.livesYes < 8 && p.lower > 0) {
                vm.prank(alice);
                ext.addLife(id, YES, _noAuth());
            } else {
                uint8 side = uint8((r >> 8) % 2);
                uint256 n = bound(r >> 16, 1, p.size);
                if (n == p.size && p.size > 1) n = p.size - 1; // keep the pot going
                _exit(id, side == YES ? alice : bob, side, n, uint32(bound(r >> 64, 0, P)));
            }
        }
        if (ropes.pot(id).size > 0) {
            finalPrice = uint32(bound(finalPrice, 0, P));
            if (byExpiry) {
                (RopesBase.WindowAttestation memory a, bytes memory sigs) = _expiryAtt(id, 0, finalPrice, true);
                ropes.resolveExpiry(a, sigs);
            } else {
                uint256 left = ropes.pot(id).size;
                vm.prank(bob);
                ext.requestExit(id, NO, left);
                (RopesBase.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, finalPrice, true);
                ropes.resolveExit(a, sigs);
            }
        }
        assertEq(_bal(address(ropes)), 0);
        assertEq(_bal(alice) + _bal(bob), start);
    }

    /// @dev The exit fee on a real partial exit is at most 1% of the pot value exited.
    function testFuzz_exitFeeBoundOnContract(uint256 n, uint32 price, uint32 dist) public {
        dist = uint32(_grid(bound(dist, 50_000, 400_000)));
        uint256 id = _create(_rope(YES, 1_000, 500_000, 0, dist, 0, uint64(block.timestamp + 6 hours)));
        _join(id, 500_000);
        n = bound(n, 1, 1_000);
        price = uint32(bound(price, 0, P));
        RopesBase.Pot memory p = ropes.pot(id);
        uint256 exited = ext.potValue(n, p.lower, p.upper);
        uint256 cashYes = ext.yesShare(n, price, p.lower, p.upper);
        uint256 a0 = _bal(alice);
        _exit(id, alice, YES, n, price);
        uint256 fee = cashYes - (_bal(alice) - a0);
        assertLe(fee * 100, exited);
    }
}
