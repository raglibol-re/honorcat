// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {VerdictVault} from "../src/VerdictVault.sol";
import {GuaranteeBook} from "../src/GuaranteeBook.sol";
import {BatchGuard} from "../src/BatchGuard.sol";

/// @notice Deploys GuaranteeBook (operator = the relay's resolver address) and BatchGuard next to the
///         already deployed vault, and writes ../deployments/<chainId>.guarantees.json.
/// Env: DEPLOYER_PRIVATE_KEY, RESOLVER_PRIVATE_KEY (only its address is used), VAULT_ADDRESS.
contract DeployGuarantees is Script {
    function run() external returns (GuaranteeBook book, BatchGuard guard) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operator = vm.addr(vm.envUint("RESOLVER_PRIVATE_KEY"));
        VerdictVault vault = VerdictVault(vm.envAddress("VAULT_ADDRESS"));
        require(address(vault).code.length > 0, "vault not deployed");

        vm.startBroadcast(pk);
        book = new GuaranteeBook(vault, operator);
        guard = new BatchGuard();
        vm.stopBroadcast();

        string memory obj = "guarantees";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "vault", address(vault));
        vm.serializeAddress(obj, "operator", operator);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "batchGuard", address(guard));
        string memory json = vm.serializeAddress(obj, "guaranteeBook", address(book));
        string memory path =
            string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".guarantees.json");
        vm.writeJson(json, path);
        console2.log("GuaranteeBook", address(book));
        console2.log("BatchGuard", address(guard));
    }
}
