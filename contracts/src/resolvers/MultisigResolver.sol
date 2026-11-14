// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title MultisigResolver
/// @notice An immutable M-of-N ERC-1271 signer. Use its address as a pot's `resolver` so that an
///         outcome needs signatures from `threshold` distinct owners instead of a single key.
///         VerdictVault verifies it through OpenZeppelin's SignatureChecker.
/// @dev    Signature format: `threshold` 65-byte ECDSA signatures (r, s, v) over the raw digest,
///         concatenated in strictly increasing order of signer address (this rejects duplicates
///         without extra storage). Extra signatures beyond `threshold` are rejected.
///         No owner changes: deploy a new resolver to rotate keys.
contract MultisigResolver is IERC1271 {
    bytes4 private constant MAGIC = 0x1626ba7e; // IERC1271.isValidSignature.selector
    bytes4 private constant INVALID = 0xffffffff;

    uint256 public immutable threshold;
    mapping(address => bool) public isOwner;
    address[] private _owners;

    error InvalidConfig();

    event ResolverCreated(address[] owners, uint256 threshold);

    constructor(address[] memory owners_, uint256 threshold_) {
        uint256 n = owners_.length;
        if (threshold_ == 0 || threshold_ > n) revert InvalidConfig();
        for (uint256 i; i < n; ++i) {
            address o = owners_[i];
            if (o == address(0) || isOwner[o]) revert InvalidConfig();
            isOwner[o] = true;
        }
        _owners = owners_;
        threshold = threshold_;
        emit ResolverCreated(owners_, threshold_);
    }

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function isValidSignature(bytes32 digest, bytes calldata signatures) external view returns (bytes4) {
        uint256 m = threshold;
        if (signatures.length != m * 65) return INVALID;
        address last;
        for (uint256 i; i < m; ++i) {
            bytes calldata sig = signatures[i * 65:(i + 1) * 65];
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
            if (err != ECDSA.RecoverError.NoError || !isOwner[signer] || signer <= last) return INVALID;
            last = signer;
        }
        return MAGIC;
    }
}
