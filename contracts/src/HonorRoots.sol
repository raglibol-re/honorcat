// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title HonorRoots
/// @notice One Merkle root of all honor balances per day (docs/honor.md), with the rules version and
///         the last block counted. Only the relay posts; a posted root can never be changed. Honor is
///         not a token and has no cash value: this contract holds no funds and moves none.
/// @dev Leaf: keccak256(bytes.concat(keccak256(abi.encode(account, total, version, day)))), the
///      OpenZeppelin double-hash form; `total` is honor in hundredths of a point.
contract HonorRoots {
    struct Root {
        bytes32 root;
        uint32 version;
        uint64 lastBlock;
        uint64 postedAt;
    }

    /// @notice The only account allowed to post roots (the relay), fixed at deploy.
    address public immutable relay;
    /// @notice Roots by day (days since 1970-01-01 UTC).
    mapping(uint32 day => Root) public roots;
    /// @notice The newest day with a root (0 before the first).
    uint32 public latestDay;

    event RootPosted(uint32 indexed day, bytes32 root, uint32 version, uint64 lastBlock);

    error NotRelay();
    error AlreadyPosted();
    error EmptyRoot();

    constructor(address relay_) {
        relay = relay_;
    }

    /// @notice Posts the root for `day`. A day's root can be posted once and never replaced.
    function post(uint32 day, bytes32 root, uint32 version, uint64 lastBlock) external {
        if (msg.sender != relay) revert NotRelay();
        if (root == bytes32(0)) revert EmptyRoot();
        if (roots[day].root != bytes32(0)) revert AlreadyPosted();
        roots[day] = Root(root, version, lastBlock, uint64(block.timestamp));
        if (day > latestDay) latestDay = day;
        emit RootPosted(day, root, version, lastBlock);
    }

    /// @notice The leaf of an account's total honor (hundredths) under a rules version on a day.
    function leaf(address account, uint256 total, uint32 version, uint32 day) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, total, version, day))));
    }

    /// @notice Whether `account` held `total` honor (hundredths) on `day`, by the root posted for that
    ///         day. Any contract on Arc can call this with a proof from the public endpoint.
    function verify(address account, uint256 total, uint32 day, bytes32[] calldata proof) external view returns (bool) {
        Root memory r = roots[day];
        if (r.root == bytes32(0)) return false;
        return MerkleProof.verifyCalldata(proof, r.root, leaf(account, total, r.version, day));
    }
}
