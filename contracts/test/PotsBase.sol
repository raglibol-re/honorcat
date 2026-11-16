// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatPots} from "../src/HonorCatPots.sol";
import {MultisigResolver} from "../src/resolvers/MultisigResolver.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Shared setup: mock USDC, a real 2-of-3 MultisigResolver, the pots contract, and helpers
///         that sign attestations the way the samplers will.
abstract contract PotsBase is Test {
    MockUSDC internal usdc;
    HonorCatPots internal pots;
    MultisigResolver internal resolver;
    uint256[3] internal signerPks = [uint256(0x5A1), uint256(0x5A2), uint256(0x5A3)];
    uint256[] internal sorted;

    address internal alice = makeAddr("alice"); // creator
    address internal bob = makeAddr("bob"); // joiner
    address internal carol = makeAddr("carol");
    bytes32 internal constant COND = keccak256("GEMI-TEST-YES|rule");
    uint64 internal closeTime;

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
        pots = new HonorCatPots(IERC20(address(usdc)), address(this));
        closeTime = uint64(block.timestamp + 1 days);
        for (uint256 i; i < 3; ++i) {
            address a = [alice, bob, carol][i];
            usdc.mint(a, 1_000e6);
            vm.prank(a);
            usdc.approve(address(pots), type(uint256).max);
        }
    }

    function _noAuth() internal pure returns (HonorCatPots.Authorization memory a) {}

    function _params(uint8 side, uint256 n, uint32 center, uint32 tol) internal view returns (HonorCatPots.CreateParams memory c) {
        c = HonorCatPots.CreateParams({
            conditionId: COND,
            resolver: address(resolver),
            side: side,
            notional: n,
            bandCenter: center,
            tolerance: tol,
            closeTime: closeTime,
            grace: 3 days,
            window: 60,
            minSamples: 24
        });
    }

    function _create(uint8 side, uint256 n, uint32 center, uint32 tol) internal returns (uint256 id) {
        vm.prank(alice);
        id = pots.create(_params(side, n, center, tol), _noAuth());
    }

    function _sign2(bytes32 digest) internal view returns (bytes memory) {
        return bytes.concat(_sig(sorted[0], digest), _sig(sorted[2], digest));
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev The attestation for the pot's pending window (join or exit), after warping past its end.
    function _window(uint256 id, uint8 kind, uint32 price, bool valid) internal returns (HonorCatPots.WindowAttestation memory a, bytes memory sigs) {
        HonorCatPots.Pot memory p = pots.pot(id);
        a = HonorCatPots.WindowAttestation({
            potId: id,
            kind: kind,
            nonce: p.nonce,
            windowStart: p.requestTime + 1,
            windowEnd: p.requestTime + 1 + p.window,
            sampleCount: 30,
            priceYes: price,
            valid: valid,
            evidenceHash: keccak256(abi.encode("evidence", id, p.nonce))
        });
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        sigs = _sign2(pots.windowDigest(a));
    }

    function _join(uint256 id, uint32 price) internal {
        vm.prank(bob);
        pots.requestJoin(id, _noAuth());
        (HonorCatPots.WindowAttestation memory a, bytes memory sigs) = _window(id, pots.KIND_JOIN(), price, true);
        pots.resolveJoin(a, sigs);
    }

    function _outcome(uint256 id, uint8 outcome) internal view returns (HonorCatPots.OutcomeAttestation memory a, bytes memory sigs) {
        a = HonorCatPots.OutcomeAttestation({potId: id, conditionId: COND, outcome: outcome, evidenceHash: keccak256("settled")});
        sigs = _sign2(pots.outcomeDigest(a));
    }

    function _bal(address a) internal view returns (uint256) {
        return usdc.balanceOf(a);
    }
}
