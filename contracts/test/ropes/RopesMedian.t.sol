// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RopesTestBase} from "./RopesTestBase.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";
import {HonorCatRopesExtra} from "../../src/ropes/HonorCatRopesExtra.sol";
import {HonorCatPots} from "../../src/HonorCatPots.sol";
import {MedianResolver} from "../../src/resolvers/MedianResolver.sol";

/// @notice The existing MedianResolver, deployed for HonorCatRopes, prices joins, knock-outs, exits and
///         expiries with the on-chain median rule: the relay cannot pick the price for v2 pots either.
contract RopesMedianTest is RopesTestBase {
    MedianResolver internal median;

    function setUp() public override {
        super.setUp();
        address[] memory s = new address[](3);
        for (uint256 i; i < 3; ++i) s[i] = vm.addr(signerPks[i]);
        // same window layout and windowDigest, so the resolver works on the v2 address unchanged
        median = new MedianResolver(HonorCatPots(address(ropes)), s, 2);
    }

    /// @dev Each sampler signs its own average of the window; the attestation carries the median.
    function _measured(uint256 id, uint8 kind, uint64 start, uint32[3] memory price)
        internal
        returns (RopesBase.WindowAttestation memory r, bytes memory sig)
    {
        RopesBase.Pot memory p = ropes.pot(id);
        HonorCatPots.WindowAttestation memory a = HonorCatPots.WindowAttestation(id, kind, p.nonce, start, start + p.window, 0, 0, false, bytes32(0));
        MedianResolver.Average[] memory avgs = new MedianResolver.Average[](3);
        bytes[] memory sigs = new bytes[](3);
        for (uint256 i; i < 3; ++i) {
            avgs[i] = MedianResolver.Average({priceYes: price[i], valid: true, sampleCount: uint32(25 + i), evidenceHash: keccak256(abi.encode("record", i, id, kind))});
            sigs[i] = _sig(sorted[i], median.averageDigest(a, avgs[i]));
        }
        (bool ok, uint32 pr, uint32 cnt) = median.agree(avgs);
        a.valid = ok;
        a.priceYes = pr;
        a.sampleCount = cnt;
        a.evidenceHash = median.evidenceRoot(avgs);
        sig = abi.encodePacked(uint8(1), abi.encode(a, avgs, sigs));
        r = abi.decode(abi.encode(a), (RopesBase.WindowAttestation));
        if (block.timestamp < r.windowEnd) vm.warp(r.windowEnd);
    }

    function _medianRope() internal returns (uint256 id) {
        RopesBase.CreateParams memory c = _stdRope(YES);
        c.resolver = address(median);
        id = _create(c); // depth: plain 2-of-3 signatures, accepted by the median resolver
        vm.prank(bob);
        ropes.requestJoin(id, 0, _noAuth());
        (RopesBase.WindowAttestation memory a, bytes memory sig) = _measured(id, 0, ropes.pot(id).requestTime + 1, [uint32(500_000), 503_000, 498_000]);
        ropes.resolveJoin(a, sig);
        assertEq(ropes.pot(id).entry, 500_000); // the median of three
    }

    function test_median_knockOut() public {
        uint256 id = _medianRope();
        (RopesBase.WindowAttestation memory a, bytes memory sig) = _measured(id, 7, uint64(block.timestamp + 1), [uint32(390_000), 395_000, 420_000]);
        ropes.triggerKnockOut(a, sig); // median 39.5: at the post
        (a, sig) = _measured(id, 1, ropes.pot(id).requestTime + 1, [uint32(380_000), 350_000, 0]);
        uint256 b0 = _bal(bob);
        ropes.resolveExit(a, sig);
        assertEq(_bal(bob) - b0, 6_000_000);
    }

    function test_median_knockOutRefusedWhenTheMedianIsInside() public {
        uint256 id = _medianRope();
        // one sampler sees the post, the median does not
        (RopesBase.WindowAttestation memory a, bytes memory sig) = _measured(id, 7, uint64(block.timestamp + 1), [uint32(390_000), 410_000, 420_000]);
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(a, sig);
        // and the relay cannot claim a different price for the same averages
        a.priceYes = 390_000;
        vm.expectRevert(RopesBase.InvalidAttestation.selector);
        ropes.triggerKnockOut(a, sig);
    }

    function test_median_expiry() public {
        uint256 id = _medianRope();
        (RopesBase.WindowAttestation memory a, bytes memory sig) = _measured(id, 8, HonorCatRopesExtra(address(ropes)).expiryWindowStart(id, 0), [uint32(610_000), 600_000, 620_000]);
        uint256 a0 = _bal(alice);
        ext.resolveExpiry(a, sig);
        assertEq(_bal(alice) - a0, 2_100_000); // (61 − 40) × 10
    }
}
