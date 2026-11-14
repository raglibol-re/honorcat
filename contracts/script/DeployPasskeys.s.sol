// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {PasskeyAccountFactory} from "../src/passkey/PasskeyAccountFactory.sol";

/// @notice Deploys PasskeyAccountFactory (and its PasskeyAccount implementation) and writes
///         ../deployments/<chainId>.passkeys.json. Env: DEPLOYER_PRIVATE_KEY.
contract DeployPasskeys is Script {
    function run() external returns (PasskeyAccountFactory factory) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        factory = new PasskeyAccountFactory();
        vm.stopBroadcast();
        string memory obj = "passkeys";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "implementation", address(factory.implementation()));
        string memory json = vm.serializeAddress(obj, "passkeyAccountFactory", address(factory));
        vm.writeJson(
            json, string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".passkeys.json")
        );
        console2.log("PasskeyAccountFactory", address(factory));
    }
}
