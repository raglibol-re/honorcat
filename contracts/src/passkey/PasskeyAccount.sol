// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/// @title PasskeyAccount
/// @notice Minimal account controlled by one WebAuthn passkey (P-256). Anyone may submit an action,
///         typically the HonorCat relay, which pays the gas; only the passkey can authorise it.
/// @dev    Verification uses OpenZeppelin's WebAuthn library (type, challenge, UP and UV flags,
///         backup-flag consistency, low-s P-256 signature) and, on Arc, the P-256 precompile at
///         0x100 (verified on Arc testnet). On top of that this account checks the `rpIdHash` in
///         the authenticator data, which OpenZeppelin leaves to the caller, so a passkey created for
///         another website cannot act for this account.
///
///         Replay protection: every `execute` challenge commits to chainId, this account, a
///         sequential nonce, the call and a deadline. The nonce increments before the call.
///         ERC-1271 lets off-chain services (and contracts) check passkey signatures over a hash.
///
///         Deployed as minimal clones by PasskeyAccountFactory; `initialize` runs once, atomically
///         with deployment. No owner changes, no upgradeability: a lost passkey cannot be recovered
///         by us (platform passkeys are usually synced by iCloud Keychain / Google Password Manager).
contract PasskeyAccount is IERC1271 {
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;

    /// @dev EIP-712-style typed hash of an action; signed as the WebAuthn challenge.
    bytes32 public constant EXECUTE_TYPEHASH = keccak256(
        "PasskeyExecute(uint256 chainId,address account,uint256 nonce,address target,uint256 value,bytes32 dataHash,uint64 deadline)"
    );

    bytes32 public qx;
    bytes32 public qy;
    bytes32 public rpIdHash;
    uint256 public nonce;
    bool private _initialized;

    event Initialized(bytes32 qx, bytes32 qy, bytes32 rpIdHash);
    event Executed(uint256 indexed nonce, address indexed target, uint256 value, bytes32 dataHash);

    error AlreadyInitialized();
    error InvalidKey();
    error Expired();
    error InvalidSignature();
    error CallFailed(bytes returnData);

    /// @dev The implementation itself can never be initialised or used.
    constructor() {
        _initialized = true;
    }

    function initialize(bytes32 qx_, bytes32 qy_, bytes32 rpIdHash_) external {
        if (_initialized) revert AlreadyInitialized();
        if (qx_ == 0 || qy_ == 0 || rpIdHash_ == 0) revert InvalidKey();
        _initialized = true;
        qx = qx_;
        qy = qy_;
        rpIdHash = rpIdHash_;
        emit Initialized(qx_, qy_, rpIdHash_);
    }

    /// @notice The challenge the passkey must sign to run `target.call{value}(data)` before `deadline`.
    function executeDigest(address target, uint256 value, bytes calldata data, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(EXECUTE_TYPEHASH, block.chainid, address(this), nonce, target, value, keccak256(data), deadline)
        );
    }

    /// @notice Runs one call authorised by the passkey. Anyone may submit; gas is the submitter's.
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint64 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external returns (bytes memory result) {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = executeDigest(target, value, data, deadline);
        if (!_verify(digest, auth)) revert InvalidSignature();
        uint256 used = nonce;
        nonce = used + 1;
        emit Executed(used, target, value, keccak256(data));
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) revert CallFailed(result);
    }

    /// @inheritdoc IERC1271
    /// @dev `signature` is a WebAuthn assertion over `hash` (as the challenge), encoded as the six
    ///      fields flat: `abi.encode(r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON)`
    ///      (OpenZeppelin `WebAuthn.tryDecodeAuth` format).
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (bool decoded, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn.tryDecodeAuth(signature);
        if (!decoded) return 0xffffffff;
        return _verify(hash, auth) ? ERC1271_MAGIC : bytes4(0xffffffff);
    }

    function _verify(bytes32 challenge, WebAuthn.WebAuthnAuth calldata auth) internal view returns (bool) {
        // authenticatorData = rpIdHash (32) | flags (1) | signCount (4) | ...
        if (auth.authenticatorData.length < 37 || bytes32(auth.authenticatorData[:32]) != rpIdHash) return false;
        return WebAuthn.verify(abi.encodePacked(challenge), auth, qx, qy, true);
    }

    receive() external payable {}
}
