// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatPots} from "../../src/HonorCatPots.sol";
import {HonorCatRopes} from "../../src/HonorCatRopes.sol";
import {HonorCatRopesExtension} from "../../src/ropes/HonorCatRopesExtension.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";
import {MultisigResolver} from "../../src/resolvers/MultisigResolver.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice A normal pot (L = 0, U = 100) on v2 behaves exactly like today's v1 pot on the same inputs:
///         the same escrows, deposits, exit payouts with the 1% fee, and settlement. Prices on the
///         0.01-point grid and sizes in whole cents of notional, where both contracts are exact.
contract RopesV1EquivalenceTest is Test {
    MockUSDC usdc;
    HonorCatPots v1;
    HonorCatRopes v2;
    HonorCatRopesExtension x2;
    MultisigResolver res;
    uint256[] sorted;
    address a = makeAddr("a");
    address b = makeAddr("b");
    bytes32 constant COND = keccak256("EQ");
    uint64 close;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        uint256[3] memory pks = [uint256(0xB1), uint256(0xB2), uint256(0xB3)];
        address[] memory owners = new address[](3);
        for (uint256 i; i < 3; ++i) owners[i] = vm.addr(pks[i]);
        res = new MultisigResolver(owners, 2);
        sorted = new uint256[](3);
        for (uint256 i; i < 3; ++i) sorted[i] = pks[i];
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (vm.addr(sorted[j]) < vm.addr(sorted[i])) (sorted[i], sorted[j]) = (sorted[j], sorted[i]);
            }
        }
        v1 = new HonorCatPots(IERC20(address(usdc)), address(this));
        HonorCatRopesExtension impl = new HonorCatRopesExtension(IERC20(address(usdc)));
        v2 = new HonorCatRopes(IERC20(address(usdc)), address(this), address(impl));
        x2 = HonorCatRopesExtension(address(v2));
        close = uint64(block.timestamp + 1 days);
        for (uint256 i; i < 2; ++i) {
            address w = i == 0 ? a : b;
            usdc.mint(w, 1_000e6);
            vm.startPrank(w);
            usdc.approve(address(v1), type(uint256).max);
            usdc.approve(address(v2), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _sign2(bytes32 d) internal view returns (bytes memory) {
        (uint8 v1_, bytes32 r1, bytes32 s1) = vm.sign(sorted[0], d);
        (uint8 v2_, bytes32 r2, bytes32 s2) = vm.sign(sorted[1], d);
        return bytes.concat(abi.encodePacked(r1, s1, v1_), abi.encodePacked(r2, s2, v2_));
    }

    /// @dev The same normal pot on both contracts: `side` creates N = size × $0.01 at `center` ± `tol`, the
    ///      other side joins at `entry`. Returns both pot ids.
    function _open(uint8 side, uint256 size, uint32 center, uint32 tol, uint32 entry) internal returns (uint256 p1, uint256 p2) {
        uint256 n = size * 10_000;
        HonorCatPots.CreateParams memory c1 = HonorCatPots.CreateParams(COND, address(res), side, n, center, tol, close, 1 days, 30, 10);
        HonorCatPots.DepthAttestation memory d1 = HonorCatPots.DepthAttestation(COND, a, 1e12, close, uint64(block.timestamp + 60));
        RopesBase.CreateParams memory c2 = RopesBase.CreateParams(COND, address(res), side, size, center, tol, 0, 0, 0, close, 1 days, 30, 10, 0);
        RopesBase.DepthAttestation memory d2 = RopesBase.DepthAttestation(COND, a, 1e12, 10_000, true, close, uint64(block.timestamp + 60));
        bytes memory s1 = _sign2(v1.depthDigest(d1));
        bytes memory s2 = _sign2(v2.depthDigest(d2));
        HonorCatPots.Authorization memory no1;
        RopesBase.Authorization memory no2;
        vm.startPrank(a);
        p1 = v1.create(c1, d1, s1, no1);
        p2 = v2.create(c2, d2, s2, no2);
        vm.stopPrank();
        assertEq(v1.pot(p1).escrowYes + v1.pot(p1).escrowNo, v2.pot(p2).escrowYes + v2.pot(p2).escrowNo, "creator escrow");
        vm.startPrank(b);
        v1.requestJoin(p1, no1);
        v2.requestJoin(p2, 0, no2);
        vm.stopPrank();
        _resolve(p1, p2, 0, entry);
    }

    /// @dev Prices the pending window (join 0, exit 1) at `price` on both contracts.
    function _resolve(uint256 p1, uint256 p2, uint8 kind, uint32 price) internal {
        HonorCatPots.Pot memory q1 = v1.pot(p1);
        RopesBase.Pot memory q2 = v2.pot(p2);
        HonorCatPots.WindowAttestation memory w1 = HonorCatPots.WindowAttestation(p1, kind, q1.nonce, q1.requestTime + 1, q1.requestTime + 31, 20, price, true, keccak256("e1"));
        RopesBase.WindowAttestation memory w2 = RopesBase.WindowAttestation(p2, kind, q2.nonce, q2.requestTime + 1, q2.requestTime + 31, 20, price, true, keccak256("e2"));
        vm.warp(block.timestamp + 40);
        if (kind == 0) {
            v1.resolveJoin(w1, _sign2(v1.windowDigest(w1)));
            v2.resolveJoin(w2, _sign2(v2.windowDigest(w2)));
        } else {
            v1.resolveExit(w1, _sign2(v1.windowDigest(w1)));
            v2.resolveExit(w2, _sign2(v2.windowDigest(w2)));
        }
    }

    function _grid(uint256 ppm) internal pure returns (uint32) {
        return uint32((ppm / 100) * 100);
    }

    /// Join (refunds), then a full exit with the fee, at random prices: each contract pays each player
    /// exactly the same amounts, measured contract by contract.
    function testFuzz_normalPotSameAsV1_exit(uint8 side, uint256 size, uint256 center, uint256 tol, uint256 entryOff, uint256 exitP, uint8 leaver) public {
        side = side % 2;
        leaver = leaver % 2;
        size = bound(size, 1, 2_500);
        center = _grid(bound(center, 60_000, 940_000));
        tol = _grid(bound(tol, 0, 50_000));
        uint32 entry = _grid(bound(entryOff, center - tol, center + tol));
        uint32 exitPrice = _grid(bound(exitP, 0, 1_000_000));
        (uint256 p1, uint256 p2) = _open(side, size, uint32(center), uint32(tol), entry);
        assertEq(v1.pot(p1).depYes, x2.yesShare(size, entry, 0, 1_000_000), "deposits");
        address who = (leaver == side) ? a : b;
        vm.startPrank(who);
        v1.requestExit(p1, leaver, v1.pot(p1).notional);
        x2.requestExit(p2, leaver, v2.pot(p2).size);
        vm.stopPrank();
        HonorCatPots.Pot memory q1 = v1.pot(p1);
        RopesBase.Pot memory q2 = v2.pot(p2);
        HonorCatPots.WindowAttestation memory w1 = HonorCatPots.WindowAttestation(p1, 1, q1.nonce, q1.requestTime + 1, q1.requestTime + 31, 20, exitPrice, true, keccak256("e1"));
        RopesBase.WindowAttestation memory w2 = RopesBase.WindowAttestation(p2, 1, q2.nonce, q2.requestTime + 1, q2.requestTime + 31, 20, exitPrice, true, keccak256("e2"));
        vm.warp(block.timestamp + 40);
        uint256[2] memory before1 = [usdc.balanceOf(a), usdc.balanceOf(b)];
        v1.resolveExit(w1, _sign2(v1.windowDigest(w1)));
        uint256[2] memory paid1 = [usdc.balanceOf(a) - before1[0], usdc.balanceOf(b) - before1[1]];
        uint256[2] memory before2 = [usdc.balanceOf(a), usdc.balanceOf(b)];
        v2.resolveExit(w2, _sign2(v2.windowDigest(w2)));
        uint256[2] memory paid2 = [usdc.balanceOf(a) - before2[0], usdc.balanceOf(b) - before2[1]];
        assertEq(paid1[0], paid2[0], "creator paid the same");
        assertEq(paid1[1], paid2[1], "joiner paid the same");
        assertEq(paid1[0] + paid1[1], size * 10_000, "the whole pot");
        assertEq(usdc.balanceOf(address(v1)), 0);
        assertEq(usdc.balanceOf(address(v2)), 0);
    }

    /// The same, checked payout by payout through the events' numbers (exit at a price, then settlement).
    function test_normalPotSameAsV1_exitAndSettle() public {
        (uint256 p1, uint256 p2) = _open(0, 900, 600_000, 20_000, 612_300); // $9.00 at 61.23%
        assertEq(v1.pot(p1).depYes, 5_510_700);
        (uint256 y2, uint256 n2) = x2.shares(p2, 612_300);
        assertEq(y2, v1.pot(p1).depYes);
        assertEq(n2, v1.pot(p1).depNo);
        // YES takes a ninth off at 70%
        uint256 a0 = usdc.balanceOf(a);
        uint256 b0 = usdc.balanceOf(b);
        vm.startPrank(a);
        v1.requestExit(p1, 0, 1_000_000);
        x2.requestExit(p2, 0, 100);
        vm.stopPrank();
        _resolve(p1, p2, 1, 700_000);
        // each contract paid YES 0.70 − 0.01 and NO 0.30 + 0.01, so both together pay double
        assertEq(usdc.balanceOf(a) - a0, 2 * (700_000 - 10_000));
        assertEq(usdc.balanceOf(b) - b0, 2 * (300_000 + 10_000));
        // Gemini settles YES: the winner gets the rest on both
        vm.warp(close);
        HonorCatPots.OutcomeAttestation memory o1 = HonorCatPots.OutcomeAttestation(p1, COND, 1, bytes32(0));
        RopesBase.OutcomeAttestation memory o2 = RopesBase.OutcomeAttestation(p2, COND, 1, bytes32(0));
        a0 = usdc.balanceOf(a);
        v1.settle(o1, _sign2(v1.outcomeDigest(o1)));
        x2.settle(o2, _sign2(x2.outcomeDigest(o2)));
        assertEq(usdc.balanceOf(a) - a0, 2 * 8_000_000);
        assertEq(usdc.balanceOf(address(v1)), 0);
        assertEq(usdc.balanceOf(address(v2)), 0);
    }
}
