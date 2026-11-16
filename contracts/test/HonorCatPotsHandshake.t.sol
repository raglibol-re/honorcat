// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HonorCatPots} from "../src/HonorCatPots.sol";
import {PotsBase} from "./PotsBase.sol";

/// @notice D1 step 4: handshake (both sides agree, no fee, no oracle).
contract HonorCatPotsHandshakeTest is PotsBase {
    uint256 constant N = 10e6;
    uint256 constant YK = 0xA11CE;
    uint256 constant NK = 0xB0B0;
    address yesOwner;
    address noOwner;

    function _live() internal returns (uint256 id) {
        id = _create(0, N, 600_000, 20_000);
        _join(id, 600_000);
        yesOwner = vm.addr(YK);
        noOwner = vm.addr(NK);
        uint256 ty = pots.tokenOf(id, 0);
        uint256 tn = pots.tokenOf(id, 1);
        vm.prank(alice);
        pots.transferFrom(alice, yesOwner, ty);
        vm.prank(bob);
        pots.transferFrom(bob, noOwner, tn);
    }

    function test_handshake_dividesWithoutFee() public {
        uint256 id = _live();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 d = pots.handshakeDigest(id, 650_000, N, deadline);
        vm.prank(carol);
        pots.handshake(id, 650_000, N, deadline, _sig(YK, d), _sig(NK, d));
        assertEq(_bal(yesOwner), 6_500_000);
        assertEq(_bal(noOwner), 3_500_000);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Divided));
    }

    function test_handshake_partialKeepsPotLive() public {
        uint256 id = _live();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 d = pots.handshakeDigest(id, 500_000, 4e6, deadline);
        pots.handshake(id, 500_000, 4e6, deadline, _sig(YK, d), _sig(NK, d));
        assertEq(_bal(yesOwner) + _bal(noOwner), 4e6);
        assertEq(pots.pot(id).notional, 6e6);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Live));
    }

    function test_handshake_needsBothAndCannotBeReplayed() public {
        uint256 id = _live();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 d = pots.handshakeDigest(id, 500_000, 4e6, deadline);
        vm.expectRevert(HonorCatPots.NotOwner.selector);
        pots.handshake(id, 500_000, 4e6, deadline, _sig(YK, d), _sig(YK, d));
        bytes memory sy = _sig(YK, d);
        bytes memory sn = _sig(NK, d);
        pots.handshake(id, 500_000, 4e6, deadline, sy, sn);
        vm.expectRevert(HonorCatPots.NotOwner.selector); // nonce moved on
        pots.handshake(id, 500_000, 4e6, deadline, sy, sn);
    }

    function test_handshake_notDuringExitWindowOrAfterDeadline() public {
        uint256 id = _live();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 d = pots.handshakeDigest(id, 500_000, N, deadline);
        bytes memory sy = _sig(YK, d);
        bytes memory sn = _sig(NK, d);
        vm.warp(deadline + 1);
        vm.expectRevert(HonorCatPots.ExpiredSignature.selector);
        pots.handshake(id, 500_000, N, deadline, sy, sn);
    }
}
