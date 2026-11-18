// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatRopes} from "../../src/HonorCatRopes.sol";
import {HonorCatRopesExtension} from "../../src/ropes/HonorCatRopesExtension.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";
import {MultisigResolver} from "../../src/resolvers/MultisigResolver.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Shared setup for HonorCat v2: mock USDC, a real 2-of-3 MultisigResolver, the extension and
///         the pots contract, and helpers that sign attestations the way the samplers do.
abstract contract RopesTestBase is Test {
    MockUSDC internal usdc;
    HonorCatRopes internal ropes;
    HonorCatRopesExtension internal ext; // the same address as `ropes`, typed for the extension's functions
    MultisigResolver internal resolver;
    uint256[3] internal signerPks = [uint256(0x5A1), uint256(0x5A2), uint256(0x5A3)];
    uint256[] internal sorted;

    address internal alice = makeAddr("alice"); // creator
    address internal bob = makeAddr("bob"); // joiner
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    bytes32 internal constant COND = keccak256("GEMI-ROPE-YES|rule");
    uint64 internal closeTime;

    uint256 internal constant P = 1_000_000;
    uint8 internal constant YES = 0;
    uint8 internal constant NO = 1;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        address[] memory owners = new address[](3);
        for (uint256 i; i < 3; ++i) owners[i] = vm.addr(signerPks[i]);
        resolver = new MultisigResolver(owners, 2);
        sorted = new uint256[](3);
        for (uint256 i; i < 3; ++i) sorted[i] = signerPks[i];
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (vm.addr(sorted[j]) < vm.addr(sorted[i])) (sorted[i], sorted[j]) = (sorted[j], sorted[i]);
            }
        }
        HonorCatRopesExtension impl = new HonorCatRopesExtension(IERC20(address(usdc)));
        ropes = new HonorCatRopes(IERC20(address(usdc)), address(this), address(impl));
        ext = HonorCatRopesExtension(address(ropes));
        closeTime = uint64(block.timestamp + 1 days);
        address[4] memory who = [alice, bob, carol, dave];
        for (uint256 i; i < 4; ++i) {
            usdc.mint(who[i], 1_000e6);
            vm.prank(who[i]);
            usdc.approve(address(ropes), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- params

    function _noAuth() internal pure returns (RopesBase.Authorization memory a) {}

    /// @dev A normal pot (no posts).
    function _normal(uint8 side, uint256 size, uint32 center, uint32 tol) internal view returns (RopesBase.CreateParams memory c) {
        c = _rope(side, size, center, tol, 0, 0, 0);
    }

    function _rope(uint8 side, uint256 size, uint32 center, uint32 tol, uint32 dY, uint32 dN, uint64 expiry)
        internal
        view
        returns (RopesBase.CreateParams memory c)
    {
        c = RopesBase.CreateParams({
            conditionId: COND,
            resolver: address(resolver),
            side: side,
            size: size,
            bandCenter: center,
            tolerance: tol,
            distYes: dY,
            distNo: dN,
            expiry: expiry,
            closeTime: closeTime,
            grace: 3 days,
            window: 60,
            minSamples: 24,
            copyOf: 0
        });
    }

    /// @dev The standard rope used across tests: YES 5× at 50 (L = 40, U = 100), expiry in 6 hours.
    ///      size 1,000 hundredths = 10 contracts: YES deposits $1.00, NO $5.00, pot $6.00.
    function _stdRope(uint8 side) internal view returns (RopesBase.CreateParams memory) {
        return _rope(side, 1_000, 500_000, 0, 100_000, 0, uint64(block.timestamp + 6 hours));
    }

    function _depth(address who, uint64 contracts5c, uint32 spread, bool crypto)
        internal
        view
        returns (RopesBase.DepthAttestation memory d, bytes memory sigs)
    {
        d = RopesBase.DepthAttestation({
            conditionId: COND,
            account: who,
            contracts5c: contracts5c,
            spread: spread,
            crypto: crypto,
            closeTime: closeTime,
            validUntil: uint64(block.timestamp + 60)
        });
        sigs = _sign2(ropes.depthDigest(d));
    }

    function _createAs(address who, RopesBase.CreateParams memory c) internal returns (uint256 id) {
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth(who, 10_000_000, 20_000, true);
        vm.prank(who);
        id = ropes.create(c, d, sigs, _noAuth());
    }

    function _create(RopesBase.CreateParams memory c) internal returns (uint256) {
        return _createAs(alice, c);
    }

    // ---------------------------------------------------------------- signatures and attestations

    function _sign2(bytes32 digest) internal view returns (bytes memory) {
        return bytes.concat(_sig(sorted[0], digest), _sig(sorted[2], digest));
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev The attestation for the pot's pending forward window (join, exit or knock-out), after warping past it.
    function _window(uint256 id, uint8 kind, uint32 price, bool valid) internal returns (RopesBase.WindowAttestation memory a, bytes memory sigs) {
        RopesBase.Pot memory p = ropes.pot(id);
        a = _att(id, kind, p.nonce, p.requestTime + 1, p.window, price, valid);
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        sigs = _sign2(ropes.windowDigest(a));
    }

    function _att(uint256 id, uint8 kind, uint64 nonce, uint64 start, uint32 window, uint32 price, bool valid)
        internal
        pure
        returns (RopesBase.WindowAttestation memory a)
    {
        a = RopesBase.WindowAttestation({
            potId: id,
            kind: kind,
            nonce: nonce,
            windowStart: start,
            windowEnd: start + window,
            sampleCount: valid ? 30 : 0,
            priceYes: price,
            valid: valid,
            evidenceHash: keccak256(abi.encode("evidence", id, kind, nonce, start))
        });
    }

    /// @dev A threshold window at `price` starting now + 1, warped to its end, signed.
    function _knockAtt(uint256 id, uint32 price) internal returns (RopesBase.WindowAttestation memory a, bytes memory sigs) {
        RopesBase.Pot memory p = ropes.pot(id);
        a = _att(id, 7, p.nonce, uint64(block.timestamp + 1), p.window, price, true);
        vm.warp(a.windowEnd);
        sigs = _sign2(ropes.windowDigest(a));
    }

    function _knockOut(uint256 id, uint32 triggerPrice, uint32 exitPrice) internal {
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _knockAtt(id, triggerPrice);
        ropes.triggerKnockOut(a, sigs);
        (a, sigs) = _window(id, 1, exitPrice, true);
        ropes.resolveExit(a, sigs);
    }

    /// @dev The expiry window number `attempt`, warped past its end, signed.
    function _expiryAtt(uint256 id, uint8 attempt, uint32 price, bool valid) internal returns (RopesBase.WindowAttestation memory a, bytes memory sigs) {
        RopesBase.Pot memory p = ropes.pot(id);
        a = _att(id, 8, p.nonce, ext.expiryWindowStart(id, attempt), p.window, price, valid);
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        sigs = _sign2(ropes.windowDigest(a));
    }

    function _joinAs(address who, uint256 id, uint32 price) internal {
        vm.prank(who);
        ropes.requestJoin(id, 0, _noAuth());
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _window(id, 0, price, true);
        ropes.resolveJoin(a, sigs);
    }

    function _join(uint256 id, uint32 price) internal {
        _joinAs(bob, id, price);
    }

    function _exit(uint256 id, address who, uint8 side, uint256 size, uint32 price) internal {
        vm.prank(who);
        ext.requestExit(id, side, size);
        (RopesBase.WindowAttestation memory a, bytes memory sigs) = _window(id, 1, price, true);
        ropes.resolveExit(a, sigs);
    }

    function _outcome(uint256 id, uint8 outcome) internal view returns (RopesBase.OutcomeAttestation memory a, bytes memory sigs) {
        a = RopesBase.OutcomeAttestation({potId: id, conditionId: COND, outcome: outcome, evidenceHash: keccak256("settled")});
        sigs = _sign2(ext.outcomeDigest(a));
    }

    function _bal(address a) internal view returns (uint256) {
        return usdc.balanceOf(a);
    }

    function _state(uint256 id) internal view returns (RopesBase.State) {
        return ropes.pot(id).state;
    }
}
