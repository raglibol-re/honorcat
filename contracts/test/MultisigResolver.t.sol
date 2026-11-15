// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MultisigResolver} from "../src/resolvers/MultisigResolver.sol";

/// @notice The M-of-N ERC-1271 signer set used by the samplers (2 of 3 on Arc testnet), tested on
///         its own: valid sets return the ERC-1271 magic value, everything else does not.
contract MultisigResolverTest is Test {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    uint256[3] internal pks = [uint256(0xA11CE), uint256(0xB0B), uint256(0xCA7)];
    bytes32 internal constant DIGEST = keccak256("an attested price window");

    MultisigResolver internal m;
    uint256[] internal sorted; // owner keys, sorted by address ascending

    function setUp() public {
        address[] memory owners = new address[](3);
        for (uint256 i; i < 3; ++i) owners[i] = vm.addr(pks[i]);
        m = new MultisigResolver(owners, 2);
        sorted = new uint256[](3);
        for (uint256 i; i < 3; ++i) sorted[i] = pks[i];
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (vm.addr(sorted[j]) < vm.addr(sorted[i])) (sorted[i], sorted[j]) = (sorted[j], sorted[i]);
            }
        }
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _valid(bytes memory sigs, bytes32 digest) internal view returns (bool) {
        try m.isValidSignature(digest, sigs) returns (bytes4 r) {
            return r == MAGIC;
        } catch {
            return false;
        }
    }

    function test_twoOfThreeIsValid() public view {
        assertTrue(_valid(bytes.concat(_sig(sorted[0], DIGEST), _sig(sorted[2], DIGEST)), DIGEST));
        assertTrue(_valid(bytes.concat(_sig(sorted[1], DIGEST), _sig(sorted[2], DIGEST)), DIGEST));
    }

    function test_rejectsSingleSignature() public view {
        assertFalse(_valid(_sig(sorted[0], DIGEST), DIGEST));
    }

    function test_rejectsDuplicateAndUnsorted() public view {
        assertFalse(_valid(bytes.concat(_sig(sorted[0], DIGEST), _sig(sorted[0], DIGEST)), DIGEST));
        assertFalse(_valid(bytes.concat(_sig(sorted[2], DIGEST), _sig(sorted[0], DIGEST)), DIGEST));
    }

    function test_rejectsOutsider() public view {
        uint256 outsider = 0x999;
        (uint256 a, uint256 b) = vm.addr(outsider) < vm.addr(sorted[0]) ? (outsider, sorted[0]) : (sorted[0], outsider);
        assertFalse(_valid(bytes.concat(_sig(a, DIGEST), _sig(b, DIGEST)), DIGEST));
    }

    function test_signaturesBoundToDigest() public view {
        bytes32 other = keccak256("a different window");
        assertFalse(_valid(bytes.concat(_sig(sorted[0], other), _sig(sorted[1], other)), DIGEST));
    }

    function test_rejectsExtraSignatures() public view {
        assertFalse(_valid(bytes.concat(_sig(sorted[0], DIGEST), _sig(sorted[1], DIGEST), _sig(sorted[2], DIGEST)), DIGEST));
    }

    function test_invalidConfig() public {
        address[] memory owners = new address[](2);
        owners[0] = vm.addr(1);
        owners[1] = vm.addr(1);
        vm.expectRevert(MultisigResolver.InvalidConfig.selector);
        new MultisigResolver(owners, 1);
        owners[1] = vm.addr(2);
        vm.expectRevert(MultisigResolver.InvalidConfig.selector);
        new MultisigResolver(owners, 3);
        vm.expectRevert(MultisigResolver.InvalidConfig.selector);
        new MultisigResolver(owners, 0);
    }
}
