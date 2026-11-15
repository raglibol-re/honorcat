// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VerdictVault} from "../src/VerdictVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {BatchGuard, IPotCounter} from "../src/BatchGuard.sol";

/// Stateless fuzz tests for properties that hold for a single pot with arbitrary parameters.
contract FuzzTest is Test {
    VerdictVault vault;
    MockUSDC usdc;
    uint256 constant RESOLVER_PK = 0xBEEF;
    address funder = makeAddr("funder");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new VerdictVault(IERC20(address(usdc)), 1 hours);
        usdc.mint(funder, type(uint128).max);
        vm.prank(funder);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _payees(uint256 seed, uint256 n) internal pure returns (address[] memory p, uint16[] memory s) {
        p = new address[](n);
        s = new uint16[](n);
        uint256 left = 10_000;
        for (uint256 i; i < n; ++i) {
            p[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1 << 150));
            uint256 v = i == n - 1 ? left : 1 + (uint256(keccak256(abi.encode(seed, "s", i))) % (left - (n - 1 - i)));
            s[i] = uint16(v);
            left -= v;
        }
    }

    function _sig(uint256 id, bytes32 cond, bool outcome) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RESOLVER_PK, vault.resolutionDigest(id, cond, outcome));
        return abi.encodePacked(r, s, v);
    }

    /// Payouts always sum to the pot total, each payee gets floor(total*bps/1e4) except the last,
    /// which gets the remainder (< n units more than its exact share).
    function testFuzz_payoutsSumToTotalAndFollowShares(uint256 seed, uint8 nRaw, uint128 amountRaw) public {
        uint256 n = bound(nRaw, 1, vault.MAX_PAYEES());
        uint256 amount = bound(amountRaw, 1, type(uint96).max);
        (address[] memory p, uint16[] memory s) = _payees(seed, n);
        bytes32 cond = keccak256(abi.encode(seed));
        uint256 id = vault.createPot(cond, vm.addr(RESOLVER_PK), p, s, funder, uint64(block.timestamp + 1 days));
        vm.prank(funder);
        vault.fund(id, amount);
        bytes memory sig = _sig(id, cond, true);
        vault.resolve(id, true, sig);

        uint256 sum;
        for (uint256 i; i < n; ++i) {
            uint256 got = usdc.balanceOf(p[i]) + vault.claimable(p[i]);
            uint256 exact = (amount * s[i]) / 10_000;
            if (i < n - 1) assertEq(got, exact);
            else assertLe(got - exact, n);
            sum += got;
        }
        assertEq(sum, amount);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    /// A refund returns everything to refundTo regardless of how many fundings there were.
    function testFuzz_refundReturnsEverything(uint256 seed, uint8 fundings, uint64 a1) public {
        (address[] memory p, uint16[] memory s) = _payees(seed, 2);
        address refundTo = makeAddr("refundTo");
        bytes32 cond = keccak256(abi.encode("r", seed));
        uint256 id = vault.createPot(cond, vm.addr(RESOLVER_PK), p, s, refundTo, uint64(block.timestamp + 1 days));
        uint256 total;
        uint256 k = bound(fundings, 1, 8);
        for (uint256 i; i < k; ++i) {
            uint256 amt = bound(uint256(keccak256(abi.encode(a1, i))), 1, 1e15);
            vm.prank(funder);
            vault.fund(id, amt);
            total += amt;
        }
        bytes memory sig = _sig(id, cond, false);
        vault.resolve(id, false, sig);
        assertEq(usdc.balanceOf(refundTo), total);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    /// The resolution window is exactly [.., deadline + grace]; expiry exactly after it.
    function testFuzz_resolutionWindowBoundary(uint32 dt) public {
        (address[] memory p, uint16[] memory s) = _payees(1, 1);
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = vault.createPot(bytes32("w"), vm.addr(RESOLVER_PK), p, s, funder, deadline);
        vm.prank(funder);
        vault.fund(id, 1e6);
        vm.warp(uint256(deadline) + 1 hours + bound(dt, 0, 10 days) + 0);
        bytes memory sig = _sig(id, bytes32("w"), true);
        if (block.timestamp <= uint256(deadline) + 1 hours) {
            vault.resolve(id, true, sig);
        } else {
            vm.expectRevert(VerdictVault.ResolutionWindowClosed.selector);
            vault.resolve(id, true, sig);
            vault.expire(id);
            assertEq(uint8(vault.getPot(id).status), uint8(VerdictVault.Status.Expired));
        }
    }

    /// BatchGuard.expectNextPotId accepts exactly potCount + 1.
    function testFuzz_expectNextPotId(uint8 created, uint256 guess) public {
        BatchGuard guard = new BatchGuard();
        (address[] memory p, uint16[] memory s) = _payees(2, 1);
        uint256 k = bound(created, 0, 10);
        for (uint256 i; i < k; ++i) {
            vault.createPot(bytes32(i), vm.addr(RESOLVER_PK), p, s, funder, uint64(block.timestamp + 1 days));
        }
        guard.expectNextPotId(IPotCounter(address(vault)), k + 1);
        guess = bound(guess, 0, 1000);
        if (guess != k + 1) {
            vm.expectRevert(abi.encodeWithSelector(BatchGuard.UnexpectedPotId.selector, guess, k + 1));
            guard.expectNextPotId(IPotCounter(address(vault)), guess);
        }
    }

    /// A signature for one pot never settles another pot, even with the same condition.
    function testFuzz_signatureBoundToPot(uint8 otherRaw) public {
        (address[] memory p, uint16[] memory s) = _payees(3, 1);
        uint256 a =
            vault.createPot(bytes32("same"), vm.addr(RESOLVER_PK), p, s, funder, uint64(block.timestamp + 1 days));
        uint256 b =
            vault.createPot(bytes32("same"), vm.addr(RESOLVER_PK), p, s, funder, uint64(block.timestamp + 1 days));
        vm.startPrank(funder);
        vault.fund(a, 1e6);
        vault.fund(b, 1e6);
        vm.stopPrank();
        bytes memory sigA = _sig(a, bytes32("same"), otherRaw % 2 == 0);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(b, otherRaw % 2 == 0, sigA);
    }
}
