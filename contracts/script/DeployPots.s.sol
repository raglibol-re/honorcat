// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatPots} from "../src/HonorCatPots.sol";

/// @notice Deploys HonorCatPots on Arc testnet with Arc USDC (0x3600…0000, ERC-20 view, 6 decimals).
///         The owner may only pause new pots, set the fee for new pots and the testnet maximum; it has
///         no access to funds. Writes ../deployments/<chainId>.pots.json.
/// Env: DEPLOYER_PRIVATE_KEY.
contract DeployPots is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (HonorCatPots pots) {
        require(block.chainid == 5042002 || block.chainid == 31337, "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(pk);

        vm.startBroadcast(pk);
        pots = new HonorCatPots(IERC20(ARC_USDC), owner);
        vm.stopBroadcast();

        string memory obj = "pots";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "usdc", ARC_USDC);
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeUint(obj, "deployBlock", block.number);
        string memory json = vm.serializeAddress(obj, "pots", address(pots));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".pots.json"));
        console2.log("HonorCatPots", address(pots));
    }
}
