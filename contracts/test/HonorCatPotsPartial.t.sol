// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HonorCatPots} from "../src/HonorCatPots.sol";
import {PotsBase} from "./PotsBase.sol";

/// @notice D1 step 3: partial exits (and nine lives, which are partial exits in ninths).
contract HonorCatPotsPartialTest is PotsBase {
    uint256 constant N = 9e6;

    function _live(uint32 entry) internal returns (uint256 id) {
        id = _create(0, N, entry, 20_000);
        _join(id, entry);
    }

    function _exit(uint256 id, uint8 side, uint256 n, uint32 price) internal {
        address who = side == 0 ? alice : bob;
        vm.prank(who);
        pots.requestExit(id, side, n);
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, price, true);
        pots.resolveExit(a, sigs);
        vm.warp(block.timestamp + 1);
    }

    function test_partial_shrinksBothSidesAndPotContinues() public {
        uint256 id = _live(600_000); // depYes 5.4, depNo 3.6
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        _exit(id, 0, 3e6, 700_000); // a third, at 70%
        // Of the 3.00 exited: YES share 2.10 minus fee 0.03; NO 0.90 plus fee.
        assertEq(_bal(alice) - a0, 2_070_000);
        assertEq(_bal(bob) - b0, 930_000);
        HonorCatPots.Pot memory p = pots.pot(id);
        assertEq(p.notional, 6e6);
        assertEq(p.depYes, 3_600_000);
        assertEq(p.depNo, 2_400_000);
        assertEq(uint8(p.state), uint8(HonorCatPots.State.Live));
        assertEq(_bal(address(pots)), 6e6);
    }

    function test_nineLives_ninthsNeverLoseOrCreateACent() public {
        uint256 id = _live(550_000);
        uint256 total0 = _bal(alice) + _bal(bob) + _bal(address(pots));
        uint32[9] memory prices = [uint32(550_000), 610_000, 333_333, 999_999, 1, 500_001, 777_777, 123_457, 650_000];
        for (uint256 k; k < 8; ++k) {
            uint256 ninth = N / 9;
            _exit(id, uint8(k % 2), ninth, prices[k]);
            HonorCatPots.Pot memory p = pots.pot(id);
            assertEq(p.depYes + p.depNo, p.notional);
            assertEq(_bal(address(pots)), p.notional);
        }
        uint256 rest = pots.pot(id).notional;
        _exit(id, 0, rest, prices[8]); // the last life takes whatever remains
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Divided));
        assertEq(_bal(address(pots)), 0);
        assertEq(_bal(alice) + _bal(bob), total0);
    }

    function test_partial_refusedAboveNotionalOrZero() public {
        uint256 id = _live(600_000);
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.BadParams.selector);
        pots.requestExit(id, 0, N + 1);
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.BadParams.selector);
        pots.requestExit(id, 0, 0);
    }

    /// Fuzz: any partial exit at any price and fee keeps the books exact.
    function testFuzz_partialConservation(uint256 n, uint32 price, uint32 entry) public {
        entry = uint32(bound(entry, 20_000, 980_000));
        price = uint32(bound(price, 0, 1_000_000));
        uint256 id = _live(entry);
        n = bound(n, 1, N);
        uint256 total0 = _bal(alice) + _bal(bob) + _bal(address(pots));
        _exit(id, uint8(n % 2), n, price);
        HonorCatPots.Pot memory p = pots.pot(id);
        assertEq(p.depYes + p.depNo, p.notional);
        assertLe(p.depYes, p.notional);
        assertEq(_bal(address(pots)), p.notional);
        assertEq(_bal(alice) + _bal(bob) + _bal(address(pots)), total0);
    }
}
