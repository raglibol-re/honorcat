// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {MultisigResolver} from "../src/resolvers/MultisigResolver.sol";

/// @notice Deploys the 2-of-3 MultisigResolver used as the resolver of early-payout pots. Its owners
///         are the three independent samplers (Vercel app, GitHub Actions, local machine); only their
///         addresses are read from the keys. Writes ../deployments/<chainId>.samplers.json.
/// Env: DEPLOYER_PRIVATE_KEY, SAMPLER_KEY_VERCEL, SAMPLER_KEY_GITHUB, SAMPLER_KEY_LOCAL.
contract DeploySamplers is Script {
    function run() external returns (MultisigResolver resolver) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address[] memory owners = new address[](3);
        owners[0] = vm.addr(vm.envUint("SAMPLER_KEY_VERCEL"));
        owners[1] = vm.addr(vm.envUint("SAMPLER_KEY_GITHUB"));
        owners[2] = vm.addr(vm.envUint("SAMPLER_KEY_LOCAL"));

        vm.startBroadcast(pk);
        resolver = new MultisigResolver(owners, 2);
        vm.stopBroadcast();

        string memory obj = "samplers";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "threshold", 2);
        vm.serializeAddress(obj, "samplerVercel", owners[0]);
        vm.serializeAddress(obj, "samplerGithub", owners[1]);
        vm.serializeAddress(obj, "samplerLocal", owners[2]);
        vm.serializeUint(obj, "deployBlock", block.number);
        string memory json = vm.serializeAddress(obj, "resolver", address(resolver));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".samplers.json"));
        console2.log("MultisigResolver (samplers)", address(resolver));
    }
}
