// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PotsBase} from "./PotsBase.sol";
import {HonorCatPots} from "../src/HonorCatPots.sol";
import {HonorCatFairValue} from "../src/HonorCatFairValue.sol";

contract HonorCatFairValueTest is PotsBase {
    HonorCatFairValue internal reader;

    function setUp() public override {
        super.setUp();
        reader = new HonorCatFairValue();
    }

    function _quote(uint256 id, uint32 price) internal view returns (HonorCatPots.WindowAttestation memory a, bytes memory sigs) {
        HonorCatPots.Pot memory p = pots.pot(id);
        a = HonorCatPots.WindowAttestation({
            potId: id,
            kind: 6,
            nonce: p.nonce,
            windowStart: uint64(block.timestamp) - p.window,
            windowEnd: uint64(block.timestamp),
            sampleCount: 30,
            priceYes: price,
            valid: true,
            evidenceHash: keccak256("quote")
        });
        sigs = _sign2(pots.windowDigest(a));
    }

    function _live() internal returns (uint256 id) {
        id = _create(0, 10e6, 600_000, 50_000);
        _join(id, 600_000);
        vm.warp(block.timestamp + 100);
    }

    function test_valuesBothSides() public {
        uint256 id = _live();
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _quote(id, 700_000);
        (uint256 yes, uint256 fee, uint32 p) = reader.fairValue(pots, 0, a, sigs, 60);
        (uint256 no,,) = reader.fairValue(pots, 1, a, sigs, 60);
        assertEq(yes, 7e6);
        assertEq(no, 3e6);
        assertEq(yes + no, 10e6);
        assertEq(fee, 0.1e6);
        assertEq(p, 700_000);
    }

    function test_rejectsStale() public {
        uint256 id = _live();
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _quote(id, 700_000);
        vm.warp(block.timestamp + 61);
        vm.expectRevert(HonorCatFairValue.StaleQuote.selector);
        reader.fairValue(pots, 0, a, sigs, 60);
    }

    function test_rejectsExitKindAndInvalid() public {
        uint256 id = _live();
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _quote(id, 700_000);
        a.kind = 1;
        sigs = _sign2(pots.windowDigest(a));
        vm.expectRevert(HonorCatFairValue.BadQuote.selector);
        reader.fairValue(pots, 0, a, sigs, 60);
        a.kind = 6;
        a.valid = false;
        sigs = _sign2(pots.windowDigest(a));
        vm.expectRevert(HonorCatFairValue.BadQuote.selector);
        reader.fairValue(pots, 0, a, sigs, 60);
    }

    function test_rejectsOneSignerOrTamperedPrice() public {
        uint256 id = _live();
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _quote(id, 700_000);
        a.priceYes = 900_000; // signatures were for 70%
        vm.expectRevert(HonorCatFairValue.BadSignatures.selector);
        reader.fairValue(pots, 0, a, sigs, 60);
        a.priceYes = 700_000;
        bytes memory one = _sig(sorted[0], pots.windowDigest(a));
        vm.expectRevert(HonorCatFairValue.BadSignatures.selector);
        reader.fairValue(pots, 0, a, one, 60);
    }

    function test_rejectsPotNotLive() public {
        uint256 id = _create(0, 10e6, 600_000, 50_000); // Open, never joined
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _quote(id, 600_000);
        vm.expectRevert(HonorCatFairValue.NotLive.selector);
        reader.fairValue(pots, 0, a, sigs, 60);
    }

    function test_quoteCannotMoveMoney() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.requestExit(id, 0, 10e6);
        HonorCatPots.Pot memory p = pots.pot(id);
        vm.warp(p.requestTime + 1 + p.window);
        HonorCatPots.WindowAttestation memory a = HonorCatPots.WindowAttestation({
            potId: id,
            kind: 6,
            nonce: p.nonce,
            windowStart: p.requestTime + 1,
            windowEnd: p.requestTime + 1 + p.window,
            sampleCount: 30,
            priceYes: 700_000,
            valid: true,
            evidenceHash: keccak256("quote")
        });
        bytes memory sigs = _sign2(pots.windowDigest(a));
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.resolveExit(a, sigs);
    }

    function test_quoteCannotTriggerALevel() public {
        uint256 id = _live();
        vm.prank(alice);
        pots.setLevels(id, 0, 0, 650_000);
        vm.warp(block.timestamp + 200);
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _quote(id, 700_000);
        vm.expectRevert(HonorCatPots.InvalidAttestation.selector);
        pots.triggerLevel(a, sigs);
    }
}
