// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatGroups} from "../src/HonorCatGroups.sol";
import {HonorCatPots} from "../src/HonorCatPots.sol";
import {MedianResolver} from "../src/resolvers/MedianResolver.sol";

/// @notice Deploys HonorCatGroups (Arc USDC) and a MedianResolver bound to it with the three samplers
///         of deployments/<chainId>.samplers.json (2 of 3), the same resolver code the pots use (it
///         only needs `windowDigest`, which the group contract has with the same layout). No owner.
///         Writes deployments/<chainId>.groups.json. Env: DEPLOYER_PRIVATE_KEY.
contract DeployGroups is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (HonorCatGroups groups, MedianResolver median) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        string memory root = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid));
        string memory s = vm.readFile(string.concat(root, ".samplers.json"));
        address[] memory samplers = new address[](3);
        samplers[0] = vm.parseJsonAddress(s, ".samplerVercel");
        samplers[1] = vm.parseJsonAddress(s, ".samplerGithub");
        samplers[2] = vm.parseJsonAddress(s, ".samplerLocal");

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        groups = new HonorCatGroups(IERC20(ARC_USDC));
        median = new MedianResolver(HonorCatPots(address(groups)), samplers, 2);
        vm.stopBroadcast();

        string memory obj = "groups";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "median", address(median));
        string memory json = vm.serializeAddress(obj, "groups", address(groups));
        vm.writeJson(json, string.concat(root, ".groups.json"));
        console2.log("HonorCatGroups", address(groups));
        console2.log("MedianResolver (groups)", address(median));
    }
}
