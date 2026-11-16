// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {HonorCatPots} from "../src/HonorCatPots.sol";
import {MedianResolver} from "../src/resolvers/MedianResolver.sol";

/// @notice Deploys MedianResolver for the deployed HonorCatPots with the three samplers of
///         deployments/<chainId>.samplers.json (2 of 3). No owner. Writes deployments/<chainId>.median.json.
///         Env: DEPLOYER_PRIVATE_KEY.
contract DeployMedian is Script {
    function run() external returns (MedianResolver median) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        string memory root = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid));
        string memory potsJson = vm.readFile(string.concat(root, ".pots.json"));
        string memory s = vm.readFile(string.concat(root, ".samplers.json"));
        address[] memory samplers = new address[](3);
        samplers[0] = vm.parseJsonAddress(s, ".samplerVercel");
        samplers[1] = vm.parseJsonAddress(s, ".samplerGithub");
        samplers[2] = vm.parseJsonAddress(s, ".samplerLocal");
        HonorCatPots pots = HonorCatPots(vm.parseJsonAddress(potsJson, ".pots"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        median = new MedianResolver(pots, samplers, 2);
        vm.stopBroadcast();

        string memory obj = "median";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "pots", address(pots));
        string memory json = vm.serializeAddress(obj, "median", address(median));
        vm.writeJson(json, string.concat(root, ".median.json"));
        console2.log("MedianResolver", address(median));
    }
}
