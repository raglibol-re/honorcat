// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatRopes} from "../src/HonorCatRopes.sol";
import {HonorCatRopesExtension} from "../src/ropes/HonorCatRopesExtension.sol";
import {HonorCatPots} from "../src/HonorCatPots.sol";
import {MedianResolver} from "../src/resolvers/MedianResolver.sol";

/// @notice Deploys HonorCat v2 on Arc testnet: the extension, HonorCatRopes (Arc USDC, ERC-20 view,
///         6 decimals) and a MedianResolver for it with the three samplers of
///         deployments/<chainId>.samplers.json (2 of 3). The owner may only pause new pots and change
///         the testnet maximum; it has no fee setter and no access to funds. Does not touch
///         HonorCatPots or its pots. Writes ../deployments/<chainId>.ropes.json.
/// Env: DEPLOYER_PRIVATE_KEY.
contract DeployRopes is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (HonorCatRopes ropes, MedianResolver median) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        string memory root = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid));
        string memory s = vm.readFile(string.concat(root, ".samplers.json"));
        address[] memory samplers = new address[](3);
        samplers[0] = vm.parseJsonAddress(s, ".samplerVercel");
        samplers[1] = vm.parseJsonAddress(s, ".samplerGithub");
        samplers[2] = vm.parseJsonAddress(s, ".samplerLocal");

        vm.startBroadcast(pk);
        HonorCatRopesExtension ext = new HonorCatRopesExtension(IERC20(ARC_USDC));
        ropes = new HonorCatRopes(IERC20(ARC_USDC), owner, address(ext));
        median = new MedianResolver(HonorCatPots(address(ropes)), samplers, 2);
        vm.stopBroadcast();

        string memory obj = "ropes";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "usdc", ARC_USDC);
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "extension", address(ext));
        vm.serializeAddress(obj, "median", address(median));
        string memory json = vm.serializeAddress(obj, "ropes", address(ropes));
        vm.writeJson(json, string.concat(root, ".ropes.json"));
        console2.log("HonorCatRopes", address(ropes));
        console2.log("HonorCatRopesExtension", address(ext));
        console2.log("MedianResolver (ropes)", address(median));
    }
}
