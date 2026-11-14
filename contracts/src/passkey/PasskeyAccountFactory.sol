// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PasskeyAccount} from "./PasskeyAccount.sol";

/// @title PasskeyAccountFactory
/// @notice Deterministic passkey accounts: the address follows from (public key, RP ID hash), so a
///         payee can be enrolled and paid before their account is deployed. Deployment and
///         initialisation happen in one call; anyone may deploy (the relay does, paying gas).
contract PasskeyAccountFactory {
    PasskeyAccount public immutable implementation;

    event AccountCreated(address indexed account, bytes32 qx, bytes32 qy, bytes32 rpIdHash);

    constructor() {
        implementation = new PasskeyAccount();
    }

    function salt(bytes32 qx, bytes32 qy, bytes32 rpIdHash) public pure returns (bytes32) {
        return keccak256(abi.encode(qx, qy, rpIdHash));
    }

    function accountAddress(bytes32 qx, bytes32 qy, bytes32 rpIdHash) public view returns (address) {
        return Clones.predictDeterministicAddress(address(implementation), salt(qx, qy, rpIdHash));
    }

    /// @notice Deploys the account if needed and returns its address (idempotent).
    function createAccount(bytes32 qx, bytes32 qy, bytes32 rpIdHash) external returns (address account) {
        account = accountAddress(qx, qy, rpIdHash);
        if (account.code.length > 0) return account;
        Clones.cloneDeterministic(address(implementation), salt(qx, qy, rpIdHash));
        PasskeyAccount(payable(account)).initialize(qx, qy, rpIdHash);
        emit AccountCreated(account, qx, qy, rpIdHash);
    }
}
