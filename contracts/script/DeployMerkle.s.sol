// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {VerdictVault} from "../src/VerdictVault.sol";
import {MerkleBook} from "../src/MerkleBook.sol";

/// @notice Deploys MerkleBook (operator = the relay's resolver address) next to the deployed vault
///         and writes ../deployments/<chainId>.merkle.json.
/// Env: DEPLOYER_PRIVATE_KEY, RESOLVER_PRIVATE_KEY (only its address is used), VAULT_ADDRESS.
contract DeployMerkle is Script {
    function run() external returns (MerkleBook book) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operator = vm.addr(vm.envUint("RESOLVER_PRIVATE_KEY"));
        VerdictVault vault = VerdictVault(vm.envAddress("VAULT_ADDRESS"));
        require(address(vault).code.length > 0, "vault not deployed");

        vm.startBroadcast(pk);
        book = new MerkleBook(vault, operator);
        vm.stopBroadcast();

        string memory obj = "merkle";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "vault", address(vault));
        vm.serializeAddress(obj, "operator", operator);
        vm.serializeUint(obj, "deployBlock", block.number);
        string memory json = vm.serializeAddress(obj, "merkleBook", address(book));
        string memory path =
            string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".merkle.json");
        vm.writeJson(json, path);
        console2.log("MerkleBook", address(book));
    }
}
