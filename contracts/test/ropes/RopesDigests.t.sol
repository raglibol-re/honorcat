// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatRopes} from "../../src/HonorCatRopes.sol";
import {HonorCatRopesExtension} from "../../src/ropes/HonorCatRopesExtension.sol";
import {HonorCatRopesExtra} from "../../src/ropes/HonorCatRopesExtra.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";
import {HonorCatPots} from "../../src/HonorCatPots.sol";
import {MedianResolver} from "../../src/resolvers/MedianResolver.sol";

/// @notice Fixed vectors for the relay's v2 digests (relay/test/ropes.test.ts): the contract's own
///         window, depth and outcome digests and the MedianResolver's average digest, on Arc testnet's
///         chain id with contracts at fixed addresses. If a type string changes, both tests break.
contract RopesDigestVectors is Test {
    address constant ROPES = address(uint160(0xA1));
    address constant MEDIAN = address(uint160(0xB2));

    function test_vectors() public {
        vm.chainId(5042002);
        HonorCatRopesExtension impl = new HonorCatRopesExtension(IERC20(address(1)), address(new HonorCatRopesExtra(IERC20(address(1)))));
        deployCodeTo("HonorCatRopes.sol:HonorCatRopes", abi.encode(IERC20(address(1)), address(this), address(impl)), ROPES);
        HonorCatRopes ropes = HonorCatRopes(ROPES);
        HonorCatRopesExtension ext = HonorCatRopesExtension(ROPES);
        HonorCatRopesExtra xr = HonorCatRopesExtra(ROPES);
        address[] memory s = new address[](3);
        s[0] = address(0x11);
        s[1] = address(0x22);
        s[2] = address(0x33);
        deployCodeTo("MedianResolver.sol:MedianResolver", abi.encode(HonorCatPots(ROPES), s, uint256(2)), MEDIAN);
        MedianResolver median = MedianResolver(MEDIAN);

        RopesBase.WindowAttestation memory w = RopesBase.WindowAttestation(7, 7, 3, 1_800_000_001, 1_800_000_031, 12, 395_000, true, bytes32(uint256(0xabc)));
        RopesBase.DepthAttestation memory d = RopesBase.DepthAttestation(bytes32(uint256(0xc0de)), address(0xBEEF), 123_456, 20_000, true, 1_800_100_000, 1_800_000_120);
        RopesBase.OutcomeAttestation memory o = RopesBase.OutcomeAttestation(7, bytes32(uint256(0xc0de)), 1, bytes32(0));
        HonorCatPots.WindowAttestation memory wv1 = abi.decode(abi.encode(w), (HonorCatPots.WindowAttestation));
        MedianResolver.Average memory avg = MedianResolver.Average(396_000, true, 14, bytes32(uint256(0xfeed)));

        assertEq(ropes.windowDigest(w), 0x635d8f04aa8e86dbc22eb7b95c7fc6542b313cbf2621451edee1934bdbdfd31d);
        assertEq(ropes.depthDigest(d), 0xf10c67021f3b9e119a2a91c729f67ea90769353035fdcf5ac74838182fbe88c9);
        assertEq(HonorCatRopesExtra(address(ropes)).outcomeDigest(o), 0x49c1509c0e9c05a74a3e0d55e22cb5fcba83cc04fa18e421054043d98598504e);
        assertEq(median.averageDigest(wv1, avg), 0x56a2217b42cf3909bea4181cc76127865cfc37addd506afab17565d73084bcec);
    }
}
