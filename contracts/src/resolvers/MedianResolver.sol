// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {HonorCatPots} from "../HonorCatPots.sol";

/// @title MedianResolver
/// @notice The samplers' signer set for HonorCatPots, with the price-agreement rule enforced on-chain.
///
///         Price windows (joins, exits, nets, bowls, quotes): the signature is not a co-signature of a
///         price someone proposed. It carries each sampler's own signed average for exactly that
///         window, and this contract computes the price itself:
///           - three valid averages: the median;
///           - two valid averages within 0.5 points (5,000 ppm): their mean (rounded down);
///           - otherwise: no price (valid = false).
///         The attestation is accepted only if its price, validity, sample count and evidence hash
///         are exactly what the averages imply. Whoever submits it (the relay or anyone) has no say.
///
///         "No price" is accepted only when every sampler's average is included, or once
///         NO_PRICE_DELAY seconds have passed after the window, so a submitter cannot fail an exit
///         at once by leaving out the averages that agree.
///
///         Everything else (depth for the cap, settlement outcomes): plain M-of-N ECDSA signatures over
///         the digest, in ascending signer order, as in MultisigResolver. Samplers never sign a raw
///         window digest for pots using this resolver; they only sign their own averages.
contract MedianResolver is IERC1271, EIP712 {
    bytes4 private constant MAGIC = 0x1626ba7e;
    bytes4 private constant INVALID = 0xffffffff;
    uint8 public constant WINDOW_MODE = 0x01;
    uint32 public constant AGREE_PPM = 5_000;
    uint256 public constant NO_PRICE_DELAY = 60;

    bytes32 public constant AVERAGE_TYPEHASH = keccak256(
        "Average(address pots,uint256 potId,uint8 kind,uint64 nonce,uint64 windowStart,uint64 windowEnd,uint32 priceYes,bool valid,uint32 sampleCount,bytes32 evidenceHash)"
    );

    /// @notice One sampler's own measurement of one window, signed by that sampler.
    struct Average {
        uint32 priceYes; // ppm
        bool valid;
        uint32 sampleCount;
        bytes32 evidenceHash; // hash of the sampler's full evidence record
    }

    HonorCatPots public immutable pots;
    uint256 public immutable threshold;
    mapping(address => bool) public isSampler;
    address[] private _samplers;

    error InvalidConfig();

    event ResolverCreated(address pots, address[] samplers, uint256 threshold);

    constructor(HonorCatPots pots_, address[] memory samplers_, uint256 threshold_) EIP712("HonorCatMedianResolver", "1") {
        uint256 n = samplers_.length;
        if (address(pots_) == address(0) || threshold_ < 2 || threshold_ > n || n > 3) revert InvalidConfig();
        for (uint256 i; i < n; ++i) {
            address s = samplers_[i];
            if (s == address(0) || isSampler[s]) revert InvalidConfig();
            isSampler[s] = true;
        }
        pots = pots_;
        _samplers = samplers_;
        threshold = threshold_;
        emit ResolverCreated(address(pots_), samplers_, threshold_);
    }

    function samplers() external view returns (address[] memory) {
        return _samplers;
    }

    /// @notice The digest a sampler signs for its average of window `a` (a's own price fields are ignored).
    function averageDigest(HonorCatPots.WindowAttestation memory a, Average memory v) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    AVERAGE_TYPEHASH, address(pots), a.potId, a.kind, a.nonce, a.windowStart, a.windowEnd, v.priceYes, v.valid, v.sampleCount, v.evidenceHash
                )
            )
        );
    }

    /// @notice The price, validity and sample count the rule gives for these averages.
    function agree(Average[] memory avgs) public pure returns (bool valid, uint32 priceYes, uint32 sampleCount) {
        uint32[3] memory p = [uint32(0), uint32(0), uint32(0)];
        uint32 minSamples = type(uint32).max;
        uint256 n = 0;
        for (uint256 i; i < avgs.length; ++i) {
            if (!avgs[i].valid) continue;
            if (n == 3) return (false, 0, 0);
            p[n++] = avgs[i].priceYes;
            if (avgs[i].sampleCount < minSamples) minSamples = avgs[i].sampleCount;
        }
        if (n == 3) {
            // median of three
            uint32 a = p[0];
            uint32 b = p[1];
            uint32 c = p[2];
            uint32 med = a > b ? (b > c ? b : (a > c ? c : a)) : (a > c ? a : (b > c ? c : b));
            return (true, med, minSamples);
        }
        if (n == 2) {
            uint32 d = p[0] > p[1] ? p[0] - p[1] : p[1] - p[0];
            if (d <= AGREE_PPM) return (true, uint32((uint256(p[0]) + p[1]) / 2), minSamples);
        }
        return (false, 0, 0);
    }

    /// @notice keccak256(abi.encode(bytes32[] evidence hashes in ascending signer order)).
    function evidenceRoot(Average[] memory avgs) public pure returns (bytes32) {
        bytes32[] memory h = new bytes32[](avgs.length);
        for (uint256 i; i < avgs.length; ++i) h[i] = avgs[i].evidenceHash;
        return keccak256(abi.encode(h));
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        if (signature.length > 0 && uint8(signature[0]) == WINDOW_MODE) return _window(digest, signature[1:]) ? MAGIC : INVALID;
        return _multisig(digest, signature) ? MAGIC : INVALID;
    }

    function _window(bytes32 digest, bytes calldata payload) internal view returns (bool) {
        (HonorCatPots.WindowAttestation memory a, Average[] memory avgs, bytes[] memory sigs) =
            abi.decode(payload, (HonorCatPots.WindowAttestation, Average[], bytes[]));
        if (pots.windowDigest(a) != digest || avgs.length != sigs.length || avgs.length > _samplers.length) return false;
        address last = address(0);
        for (uint256 i; i < avgs.length; ++i) {
            (address s, ECDSA.RecoverError err,) = ECDSA.tryRecover(averageDigest(a, avgs[i]), sigs[i]);
            if (err != ECDSA.RecoverError.NoError || !isSampler[s] || s <= last) return false;
            last = s;
        }
        (bool valid, uint32 price, uint32 count) = agree(avgs);
        if (a.valid != valid || a.evidenceHash != evidenceRoot(avgs)) return false;
        if (valid) return a.priceYes == price && a.sampleCount == count;
        // No price: provable only with every sampler's average, or after the samplers had time to report.
        if (a.priceYes != 0 || a.sampleCount != 0) return false;
        return avgs.length == _samplers.length || block.timestamp >= a.windowEnd + NO_PRICE_DELAY;
    }

    function _multisig(bytes32 digest, bytes calldata signatures) internal view returns (bool) {
        uint256 m = threshold;
        if (signatures.length != m * 65) return false;
        address last = address(0);
        for (uint256 i; i < m; ++i) {
            (address s, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signatures[i * 65:(i + 1) * 65]);
            if (err != ECDSA.RecoverError.NoError || !isSampler[s] || s <= last) return false;
            last = s;
        }
        return true;
    }
}
