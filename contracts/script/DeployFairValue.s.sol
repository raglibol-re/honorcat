// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {HonorCatFairValue} from "../src/HonorCatFairValue.sol";

/// @notice Deploys the stateless fair-value reader. No owner, no storage. Writes
///         ../deployments/<chainId>.fairvalue.json. Env: DEPLOYER_PRIVATE_KEY.
contract DeployFairValue is Script {
    function run() external returns (HonorCatFairValue reader) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        reader = new HonorCatFairValue();
        vm.stopBroadcast();
        string memory obj = "fairvalue";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        string memory json = vm.serializeAddress(obj, "fairValue", address(reader));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".fairvalue.json"));
        console2.log("HonorCatFairValue", address(reader));
    }
}
