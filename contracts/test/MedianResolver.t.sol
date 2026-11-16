// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PotsBase} from "./PotsBase.sol";
import {HonorCatPots} from "../src/HonorCatPots.sol";
import {MedianResolver} from "../src/resolvers/MedianResolver.sol";

contract MedianResolverTest is PotsBase {
    MedianResolver internal median;

    function setUp() public override {
        super.setUp();
        address[] memory s = new address[](3);
        for (uint256 i; i < 3; ++i) s[i] = vm.addr(signerPks[i]);
        median = new MedianResolver(pots, s, 2);
    }

    function _createMedian() internal returns (uint256 id) {
        HonorCatPots.CreateParams memory c = _params(0, 10e6, 600_000, 50_000);
        c.resolver = address(median);
        id = _createAs(alice, c);
    }

    /// @dev Window `[request + 1, + window]` of the pending request, each sampler's own signed average
    ///      (`use[i]` false leaves sampler i out), the attestation the rule implies, warped to its end.
    function _measured(uint256 id, uint8 kind, uint32[3] memory price, bool[3] memory valid, bool[3] memory use)
        internal
        returns (HonorCatPots.WindowAttestation memory a, bytes memory sig)
    {
        HonorCatPots.Pot memory p = pots.pot(id);
        a = HonorCatPots.WindowAttestation({
            potId: id,
            kind: kind,
            nonce: p.nonce,
            windowStart: p.requestTime + 1,
            windowEnd: p.requestTime + 1 + p.window,
            sampleCount: 0,
            priceYes: 0,
            valid: false,
            evidenceHash: bytes32(0)
        });
        uint256 n;
        for (uint256 i; i < 3; ++i) if (use[i]) n++;
        MedianResolver.Average[] memory avgs = new MedianResolver.Average[](n);
        bytes[] memory sigs = new bytes[](n);
        uint256 k;
        for (uint256 i; i < 3; ++i) {
            if (!use[i]) continue;
            avgs[k] = MedianResolver.Average({priceYes: price[i], valid: valid[i], sampleCount: uint32(25 + i), evidenceHash: keccak256(abi.encode("record", i, id))});
            sigs[k] = _sig(sorted[i], median.averageDigest(a, avgs[k]));
            k++;
        }
        (bool ok, uint32 pr, uint32 cnt) = median.agree(avgs);
        a.valid = ok;
        a.priceYes = pr;
        a.sampleCount = cnt;
        a.evidenceHash = median.evidenceRoot(avgs);
        sig = abi.encodePacked(uint8(1), abi.encode(a, avgs, sigs));
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
    }

    function _all() internal pure returns (bool[3] memory) {
        return [true, true, true];
    }

    function _live(uint32[3] memory joinPrices) internal returns (uint256 id) {
        id = _createMedian();
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sig) = _measured(id, 0, joinPrices, _all(), _all());
        pots.resolveJoin(a, sig);
    }

    function test_joinAndExitAtTheMedianOfThree() public {
        uint256 id = _live([uint32(640_000), 600_000, 610_000]);
        assertEq(pots.pot(id).depYes, 6.1e6); // median 61%
        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        pots.requestExit(id, 0, 10e6);
        (HonorCatPots.WindowAttestation memory a, bytes memory sig) = _measured(id, 1, [uint32(700_000), 720_000, 300_000], _all(), _all());
        assertEq(a.priceYes, 700_000);
        uint256 before = _bal(alice);
        pots.resolveExit(a, sig);
        assertEq(_bal(alice) - before, 7e6 - 0.1e6); // share at 70% minus the 1% fee
    }

    function test_meanOfTwoWithinHalfAPoint() public {
        uint256 id = _createMedian();
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sig) =
            _measured(id, 0, [uint32(600_000), 604_000, 900_000], [true, true, false], _all());
        assertTrue(a.valid);
        assertEq(a.priceYes, 602_000);
        pots.resolveJoin(a, sig);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Live));
    }

    function test_submitterCannotChooseThePrice() public {
        uint256 id = _live([uint32(600_000), 600_000, 600_000]);
        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        pots.requestExit(id, 0, 10e6);
        (HonorCatPots.WindowAttestation memory a, bytes memory sig) = _measured(id, 1, [uint32(700_000), 710_000, 690_000], _all(), _all());
        // Same averages, a price of the submitter's choosing: the digest no longer matches what they imply.
        HonorCatPots.WindowAttestation memory b = abi.decode(abi.encode(a), (HonorCatPots.WindowAttestation)); // a copy
        b.priceYes = 750_000;
        (, MedianResolver.Average[] memory avgs, bytes[] memory sigs) = abi.decode(_strip(sig), (HonorCatPots.WindowAttestation, MedianResolver.Average[], bytes[]));
        bytes memory forged = abi.encodePacked(uint8(1), abi.encode(b, avgs, sigs));
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveExit(b, forged);
        // Leaving out the low average to move the median is not possible either: two left must agree.
        pots.resolveExit(a, sig);
    }

    function test_noPriceNeedsEveryAverageOrTheDelay() public {
        uint256 id = _live([uint32(600_000), 600_000, 600_000]);
        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        pots.requestExit(id, 0, 10e6);
        // Two averages 2 points apart: no agreement. With only two included, "no price" waits.
        (HonorCatPots.WindowAttestation memory a, bytes memory sig) =
            _measured(id, 1, [uint32(600_000), 620_000, 0], [true, true, false], [true, true, false]);
        assertFalse(a.valid);
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveExit(a, sig);
        vm.warp(a.windowEnd + 60);
        pots.resolveExit(a, sig); // exit failed, pot continues
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Live));
    }

    function test_noPriceAtOnceWhenAllThreeShowIt() public {
        uint256 id = _live([uint32(600_000), 600_000, 600_000]);
        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        pots.requestExit(id, 0, 10e6);
        (HonorCatPots.WindowAttestation memory a, bytes memory sig) =
            _measured(id, 1, [uint32(600_000), 620_000, 0], [true, true, false], _all());
        pots.resolveExit(a, sig);
        assertEq(uint8(pots.pot(id).state), uint8(HonorCatPots.State.Live));
    }

    function test_averageForAnotherWindowOrSignerIsRejected() public {
        uint256 id = _createMedian();
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sig) = _measured(id, 0, [uint32(600_000), 600_000, 600_000], _all(), _all());
        (, MedianResolver.Average[] memory avgs, bytes[] memory sigs) = abi.decode(_strip(sig), (HonorCatPots.WindowAttestation, MedianResolver.Average[], bytes[]));
        // an outsider's signature in place of a sampler's
        bytes[] memory bad = new bytes[](3);
        bad[0] = sigs[0];
        bad[1] = sigs[1];
        bad[2] = _sig(0xBAD, median.averageDigest(a, avgs[2]));
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveJoin(a, abi.encodePacked(uint8(1), abi.encode(a, avgs, bad)));
        // the same sampler twice
        bad[2] = sigs[1];
        MedianResolver.Average[] memory dup = new MedianResolver.Average[](3);
        (dup[0], dup[1], dup[2]) = (avgs[0], avgs[1], avgs[1]);
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveJoin(a, abi.encodePacked(uint8(1), abi.encode(a, dup, bad)));
        pots.resolveJoin(a, sig);
    }

    function test_depthAndOutcomeUsePlainTwoOfThree() public {
        uint256 id = _live([uint32(600_000), 600_000, 600_000]);
        vm.warp(closeTime);
        (HonorCatPots.OutcomeAttestation memory o, bytes memory sigs) = _outcome(id, 1);
        uint256 before = _bal(alice);
        pots.settle(o, sigs);
        assertEq(_bal(alice) - before, 10e6);
    }

    function testFuzz_agreeIsTheMedianOrAgreeingMean(uint32 x, uint32 y, uint32 z, bool vz) public view {
        x = uint32(bound(x, 0, 1e6));
        y = uint32(bound(y, 0, 1e6));
        z = uint32(bound(z, 0, 1e6));
        MedianResolver.Average[] memory avgs = new MedianResolver.Average[](3);
        avgs[0] = MedianResolver.Average(x, true, 10, bytes32(0));
        avgs[1] = MedianResolver.Average(y, true, 11, bytes32(0));
        avgs[2] = MedianResolver.Average(z, vz, 12, bytes32(0));
        (bool ok, uint32 p,) = median.agree(avgs);
        if (vz) {
            assertTrue(ok);
            uint32 lo = x < y ? (x < z ? x : z) : (y < z ? y : z);
            uint32 hi = x > y ? (x > z ? x : z) : (y > z ? y : z);
            assertEq(uint256(p), uint256(x) + y + z - lo - hi);
        } else {
            uint32 d = x > y ? x - y : y - x;
            assertEq(ok, d <= 5_000);
            if (ok) assertEq(uint256(p), (uint256(x) + y) / 2);
        }
    }

    function _strip(bytes memory sig) internal pure returns (bytes memory out) {
        out = new bytes(sig.length - 1);
        for (uint256 i = 1; i < sig.length; ++i) out[i - 1] = sig[i];
    }
}
