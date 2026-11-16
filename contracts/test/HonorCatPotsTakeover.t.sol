// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HonorCatPots} from "../src/HonorCatPots.sol";
import {PotsBase} from "./PotsBase.sol";

/// @notice D1 step 6: takeover (a third party takes the exiting side's place at the exit price).
contract HonorCatPotsTakeoverTest is PotsBase {
    uint256 constant N = 10e6;

    function _exitWindow() internal returns (uint256 id) {
        id = _create(0, N, 600_000, 20_000);
        _join(id, 600_000);
        vm.prank(alice);
        pots.requestExit(id, 0, N);
    }

    function test_takeover_exiterPaidTakerGetsTokenPotContinues() public {
        uint256 id = _exitWindow();
        vm.prank(carol);
        pots.takeover(id, _noAuth());
        uint256 a0 = _bal(alice);
        uint256 b0 = _bal(bob);
        uint256 c0 = _bal(carol);
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 700_000, true);
        pots.resolveExit(a, sigs);
        // YES worth 7.00 at 70%; fee 0.10 to NO; taker refunded 10 − 7 = 3.
        assertEq(_bal(alice) - a0, 6_900_000);
        assertEq(_bal(bob) - b0, 100_000);
        assertEq(_bal(carol) - c0, 3_000_000);
        assertEq(pots.ownerOf(pots.tokenOf(id, 0)), carol);
        HonorCatPots.Pot memory p = pots.pot(id);
        assertEq(uint8(p.state), uint8(HonorCatPots.State.Live));
        assertEq(p.notional, N);
        assertEq(_bal(address(pots)), N);
    }

    function test_takeover_onePerWindowAndOnlyFullExits() public {
        uint256 id = _exitWindow();
        vm.prank(carol);
        pots.takeover(id, _noAuth());
        vm.prank(bob);
        vm.expectRevert(HonorCatPots.WrongState.selector);
        pots.takeover(id, _noAuth());

        uint256 id2 = _create(0, N, 600_000, 20_000);
        _join(id2, 600_000);
        vm.prank(alice);
        pots.requestExit(id2, 0, 3e6); // partial
        vm.prank(carol);
        vm.expectRevert(HonorCatPots.WrongState.selector);
        pots.takeover(id2, _noAuth());
    }

    function test_takeover_notAfterWindowEnds() public {
        uint256 id = _exitWindow();
        vm.warp(block.timestamp + 62);
        vm.prank(carol);
        vm.expectRevert(HonorCatPots.TooLate.selector);
        pots.takeover(id, _noAuth());
    }

    function test_takeover_refundedWhenExitFails() public {
        uint256 id = _exitWindow();
        uint256 c0 = _bal(carol);
        vm.prank(carol);
        pots.takeover(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 0, false);
        pots.resolveExit(a, sigs);
        assertEq(_bal(carol), c0);
        assertEq(pots.ownerOf(pots.tokenOf(id, 0)), alice);
        assertEq(_bal(address(pots)), N);
    }

    function test_takeover_refundedOnSettleAndExpire() public {
        uint256 id = _exitWindow();
        uint256 c0 = _bal(carol);
        vm.prank(carol);
        pots.takeover(id, _noAuth());
        vm.warp(closeTime + 3 days);
        pots.expire(id);
        assertEq(_bal(carol), c0);
        assertEq(_bal(address(pots)), 0);
    }

    function test_takeover_netsAndBowlsResetForTheNewOwner() public {
        uint256 id = _create(0, N, 600_000, 20_000);
        _join(id, 600_000);
        vm.prank(alice);
        pots.setLevels(id, 0, 400_000, 800_000);
        vm.prank(alice);
        pots.requestExit(id, 0, N);
        vm.prank(carol);
        pots.takeover(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, 600_000, true);
        pots.resolveExit(a, sigs);
        (uint32 net, uint32 bowl,) = pots.levels(pots.tokenOf(id, 0));
        assertEq(net, 0);
        assertEq(bowl, 0);
    }
}
