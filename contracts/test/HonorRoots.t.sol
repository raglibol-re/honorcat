// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {HonorRoots} from "../src/HonorRoots.sol";

contract HonorRootsTest is Test {
    HonorRoots roots;
    address relay = address(0xBEEF);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint32 constant DAY = 20_412;
    uint32 constant VERSION = 1;

    function setUp() public {
        roots = new HonorRoots(relay);
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _tree() internal view returns (bytes32 root, bytes32 la, bytes32 lb) {
        la = roots.leaf(alice, 2_450, VERSION, DAY);
        lb = roots.leaf(bob, 1_000, VERSION, DAY);
        root = _pair(la, lb);
    }

    function test_onlyRelayPosts() public {
        (bytes32 root,,) = _tree();
        vm.expectRevert(HonorRoots.NotRelay.selector);
        roots.post(DAY, root, VERSION, 100);
        vm.prank(relay);
        roots.post(DAY, root, VERSION, 100);
        (bytes32 r, uint32 v, uint64 last, uint64 at) = roots.roots(DAY);
        assertEq(r, root);
        assertEq(v, VERSION);
        assertEq(last, 100);
        assertEq(at, uint64(block.timestamp));
        assertEq(roots.latestDay(), DAY);
    }

    function test_rootCannotBeOverwritten() public {
        (bytes32 root,,) = _tree();
        vm.startPrank(relay);
        roots.post(DAY, root, VERSION, 100);
        vm.expectRevert(HonorRoots.AlreadyPosted.selector);
        roots.post(DAY, keccak256("other"), VERSION, 101);
        vm.expectRevert(HonorRoots.EmptyRoot.selector);
        roots.post(DAY + 1, bytes32(0), VERSION, 101);
        vm.stopPrank();
        (bytes32 r,,,) = roots.roots(DAY);
        assertEq(r, root);
    }

    function test_proofVerifiesAndAChangedBalanceFails() public {
        (bytes32 root,, bytes32 lb) = _tree();
        vm.prank(relay);
        roots.post(DAY, root, VERSION, 100);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = lb;
        assertTrue(roots.verify(alice, 2_450, DAY, proof));
        assertFalse(roots.verify(alice, 2_451, DAY, proof)); // a changed balance fails
        assertFalse(roots.verify(alice, 2_450, DAY + 1, proof)); // no root that day
        assertFalse(roots.verify(bob, 2_450, DAY, proof));
    }

    function test_latestDayOnlyMovesForward() public {
        vm.startPrank(relay);
        roots.post(DAY, keccak256("a"), VERSION, 100);
        roots.post(DAY - 3, keccak256("b"), VERSION, 90);
        vm.stopPrank();
        assertEq(roots.latestDay(), DAY);
    }
}
