// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HonorCatPots} from "../src/HonorCatPots.sol";
import {PotsBase} from "./PotsBase.sol";

/// @notice D1 step 5: nets (floors) and bowls (targets).
contract HonorCatPotsLevelsTest is PotsBase {
    uint256 constant N = 10e6;

    function _live() internal returns (uint256 id) {
        id = _create(0, N, 600_000, 20_000);
        _join(id, 600_000);
    }

    /// @dev A threshold attestation for `kind` whose window ends now and starts after the levels were set.
    function _threshold(uint256 id, uint8 kind, uint32 priceYes) internal returns (HonorCatPots.WindowAttestation memory a, bytes memory sigs) {
        vm.warp(block.timestamp + 62);
        HonorCatPots.Pot memory p = pots.pot(id);
        a = HonorCatPots.WindowAttestation(id, kind, p.nonce, uint64(block.timestamp - 60), uint64(block.timestamp), 30, priceYes, true, keccak256("hold"));
        sigs = _sign2(pots.windowDigest(a));
    }

    function test_net_filesExitWhenOwnPriceHoldsBelowFloor() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.setLevels(id, 0, 450_000, 0); // YES net at 45%
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _threshold(id, 2, 440_000);
        vm.prank(carol); // anyone submits
        pots.triggerLevel(a, sigs);
        HonorCatPots.Pot memory p = pots.pot(id);
        assertEq(uint8(p.state), uint8(HonorCatPots.State.ExitRequested));
        assertEq(p.exitSide, 0);
        assertEq(p.exitNotional, N);
    }

    function test_bowl_noSideUsesItsOwnPrice() public {
        uint256 id = _live();
        vm.prank(bob);
        pots.setLevels(id, 1, 0, 700_000); // NO bowl at 70% of its own price
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _threshold(id, 5, 290_000); // NO = 71%
        pots.triggerLevel(a, sigs);
        assertEq(pots.pot(id).exitSide, 1);
    }

    function test_level_notReachedRejected() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.setLevels(id, 0, 450_000, 0);
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _threshold(id, 2, 460_000);
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.triggerLevel(a, sigs);
    }

    function test_level_windowMustStartAfterSetting() public {
        uint256 id = _live();
        vm.warp(block.timestamp + 100);
        HonorCatPots.Pot memory p = pots.pot(id);
        HonorCatPots.WindowAttestation memory a =
            HonorCatPots.WindowAttestation(id, 2, p.nonce, uint64(block.timestamp - 60), uint64(block.timestamp), 30, 400_000, true, bytes32(0));
        vm.prank(alice);
        pots.setLevels(id, 0, 450_000, 0); // set after the window started
        bytes memory sigs = _sign2(pots.windowDigest(a));
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.triggerLevel(a, sigs);
    }

    function test_levels_resetOnTransferAndOnlyOwnerSets() public {
        uint256 id = _live();
        vm.prank(carol);
        vm.expectRevert(HonorCatPots.NotOwner.selector);
        pots.setLevels(id, 0, 450_000, 0);
        vm.prank(alice);
        pots.setLevels(id, 0, 450_000, 800_000);
        uint256 t = pots.tokenOf(id, 0);
        vm.prank(alice);
        pots.transferFrom(alice, carol, t);
        (uint32 net, uint32 bowl,) = pots.levels(t);
        assertEq(net, 0);
        assertEq(bowl, 0);
    }

    function test_level_rejectsNetAboveBowl() public {
        uint256 id = _live();
        vm.prank(alice);
        vm.expectRevert(HonorCatPots.BadParams.selector);
        pots.setLevels(id, 0, 800_000, 700_000);
    }
}
