// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VerdictVault} from "../src/VerdictVault.sol";

/// @notice Deploys VerdictVault and writes ../deployments/<chainId>.json for the relay and web app.
/// Env: DEPLOYER_PRIVATE_KEY, USDC_ADDRESS, GRACE_PERIOD_SECONDS (default 3600).
contract Deploy is Script {
    uint256 constant ARC_TESTNET = 5042002;

    function run() external returns (VerdictVault vault) {
        // Testnet only: refuse to deploy anywhere except Arc testnet or a local chain.
        require(block.chainid == ARC_TESTNET || block.chainid == 31337, "Deploy: testnet only");

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint256 grace = vm.envOr("GRACE_PERIOD_SECONDS", uint256(3600));

        vm.startBroadcast(pk);
        vault = new VerdictVault(IERC20(usdc), grace);
        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "usdc", usdc);
        vm.serializeUint(obj, "gracePeriod", grace);
        vm.serializeUint(obj, "deployBlock", block.number);
        string memory json = vm.serializeAddress(obj, "vault", address(vault));
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("VerdictVault deployed at", address(vault));
        console2.log("Written to", path);
    }
}
