// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {HonorRoots} from "../src/HonorRoots.sol";

/// @notice Deploys HonorRoots with the relay as the only poster (HONOR_RELAY: the address the relay
///         sends pot housekeeping from, the Circle relay wallet when configured). No owner, no funds.
///         Writes deployments/<chainId>.honor.json. Env: DEPLOYER_PRIVATE_KEY, HONOR_RELAY.
contract DeployHonorRoots is Script {
    function run() external returns (HonorRoots roots) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        address relay = vm.envAddress("HONOR_RELAY");
        require(relay != address(0), "HONOR_RELAY");
        string memory root = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        roots = new HonorRoots(relay);
        vm.stopBroadcast();

        string memory obj = "honor";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "relay", relay);
        string memory json = vm.serializeAddress(obj, "honorRoots", address(roots));
        vm.writeJson(json, string.concat(root, ".honor.json"));
        console2.log("HonorRoots", address(roots));
    }
}
