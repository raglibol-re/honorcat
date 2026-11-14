// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {VerdictVault} from "../src/VerdictVault.sol";
import {MultisigResolver} from "../src/resolvers/MultisigResolver.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// EIP-3009 gasless funding and the ERC-1271 multisig resolver.
contract GaslessTest is Test {
    VerdictVault vault;
    MockUSDC usdc;

    uint256 constant GRACE = 1 hours;
    bytes32 constant COND = keccak256("api:order-42");

    uint256 funderPk = 0xF00D;
    address funder;
    uint256 resolverPk = 0xA11CE;
    address resolver;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address refundTo = makeAddr("refundTo");
    address relayer = makeAddr("relayer");

    event PotFunded(uint256 indexed potId, address indexed funder, uint256 amount, uint256 newTotal);
    event PotCreated(
        uint256 indexed potId,
        bytes32 indexed conditionId,
        address indexed creator,
        address resolver,
        address refundTo,
        uint64 deadline,
        address[] payees,
        uint16[] sharesBps
    );

    function setUp() public {
        funder = vm.addr(funderPk);
        resolver = vm.addr(resolverPk);
        usdc = new MockUSDC();
        vault = new VerdictVault(IERC20(address(usdc)), GRACE);
        usdc.mint(funder, 1_000e6); // note: no approve, funder never sends a transaction
    }

    // ------------------------------------------------------------------ helpers

    function _params() internal view returns (VerdictVault.PotParams memory p) {
        p.conditionId = COND;
        p.resolver = resolver;
        p.payees = new address[](2);
        p.sharesBps = new uint16[](2);
        (p.payees[0], p.payees[1]) = (alice, bob);
        (p.sharesBps[0], p.sharesBps[1]) = (6000, 4000);
        p.refundTo = refundTo;
        p.deadline = uint64(block.timestamp + 1 days);
    }

    function _auth(uint256 pk, uint256 value, bytes32 nonce, bytes32 salt)
        internal
        view
        returns (VerdictVault.Authorization memory a)
    {
        a.from = vm.addr(pk);
        a.validAfter = 0;
        a.validBefore = block.timestamp + 1 hours;
        a.salt = salt;
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                a.from,
                address(vault),
                value,
                a.validAfter,
                a.validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (a.v, a.r, a.s) = vm.sign(pk, digest);
    }

    function _createPlain() internal returns (uint256) {
        VerdictVault.PotParams memory p = _params();
        return vault.createPot(p.conditionId, p.resolver, p.payees, p.sharesBps, p.refundTo, p.deadline);
    }

    function _sig(uint256 pk, uint256 potId, bool outcome) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, vault.resolutionDigest(potId, COND, outcome));
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ fundWithAuthorization

    function test_fundWithAuthorization_relayerSubmits() public {
        uint256 id = _createPlain();
        bytes32 salt = keccak256("s1");
        VerdictVault.Authorization memory a = _auth(funderPk, 25e6, vault.fundNonce(id, salt), salt);

        vm.expectEmit(address(vault));
        emit PotFunded(id, funder, 25e6, 25e6);
        vm.prank(relayer);
        vault.fundWithAuthorization(id, 25e6, a);

        assertEq(vault.getPot(id).total, 25e6);
        assertEq(usdc.balanceOf(address(vault)), 25e6);
        assertEq(usdc.balanceOf(funder), 975e6);
        assertEq(usdc.balanceOf(relayer), 0);
    }

    function test_fundWithAuthorization_cannotRedirectToOtherPot() public {
        uint256 id1 = _createPlain();
        uint256 id2 = _createPlain();
        bytes32 salt = keccak256("s1");
        VerdictVault.Authorization memory a = _auth(funderPk, 25e6, vault.fundNonce(id1, salt), salt);
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vault.fundWithAuthorization(id2, 25e6, a);
    }

    function test_fundWithAuthorization_cannotChangeAmount() public {
        uint256 id = _createPlain();
        bytes32 salt = keccak256("s1");
        VerdictVault.Authorization memory a = _auth(funderPk, 25e6, vault.fundNonce(id, salt), salt);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vault.fundWithAuthorization(id, 26e6, a);
    }

    function test_fundWithAuthorization_replayRejected() public {
        uint256 id = _createPlain();
        bytes32 salt = keccak256("s1");
        VerdictVault.Authorization memory a = _auth(funderPk, 25e6, vault.fundNonce(id, salt), salt);
        vault.fundWithAuthorization(id, 25e6, a);
        vm.expectRevert("FiatTokenV2: authorization is used or canceled");
        vault.fundWithAuthorization(id, 25e6, a);
    }

    function test_fundWithAuthorization_expiredAuthorization() public {
        uint256 id = _createPlain();
        bytes32 salt = keccak256("s1");
        VerdictVault.Authorization memory a = _auth(funderPk, 25e6, vault.fundNonce(id, salt), salt);
        vm.warp(a.validBefore);
        vm.expectRevert("FiatTokenV2: authorization is expired");
        vault.fundWithAuthorization(id, 25e6, a);
    }

    function test_fundWithAuthorization_respectsPotRules() public {
        uint256 id = _createPlain();
        bytes32 salt = keccak256("s1");
        VerdictVault.Authorization memory a = _auth(funderPk, 25e6, vault.fundNonce(id, salt), salt);
        vm.expectRevert(VerdictVault.ZeroAmount.selector);
        vault.fundWithAuthorization(id, 0, a);
        vm.expectRevert(VerdictVault.PotNotOpen.selector);
        vault.fundWithAuthorization(999, 25e6, a);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(VerdictVault.FundingClosed.selector);
        vault.fundWithAuthorization(id, 25e6, a);
    }

    function test_fundNonce_bindsChainAndVault() public {
        bytes32 n = vault.fundNonce(1, bytes32(0));
        VerdictVault other = new VerdictVault(IERC20(address(usdc)), GRACE);
        assertTrue(n != other.fundNonce(1, bytes32(0)));
        vm.chainId(1);
        assertTrue(n != vault.fundNonce(1, bytes32(0)));
    }

    // ------------------------------------------------------------------ createPotWithAuthorization

    function test_createPotWithAuthorization_oneTx() public {
        VerdictVault.PotParams memory p = _params();
        bytes32 salt = keccak256("c1");
        VerdictVault.Authorization memory a = _auth(funderPk, 10e6, vault.createNonce(p, salt), salt);

        vm.expectEmit(address(vault));
        emit PotCreated(1, COND, funder, resolver, refundTo, p.deadline, p.payees, p.sharesBps);
        vm.expectEmit(address(vault));
        emit PotFunded(1, funder, 10e6, 10e6);
        vm.prank(relayer);
        uint256 id = vault.createPotWithAuthorization(p, 10e6, a);

        assertEq(id, 1);
        assertEq(vault.getPot(id).total, 10e6);
        assertEq(usdc.balanceOf(address(vault)), 10e6);

        // and it settles like any other pot
        vault.resolve(id, true, _sig(resolverPk, id, true));
        assertEq(usdc.balanceOf(alice), 6e6);
        assertEq(usdc.balanceOf(bob), 4e6);
    }

    function test_createPotWithAuthorization_paramsAreBound() public {
        VerdictVault.PotParams memory p = _params();
        bytes32 salt = keccak256("c1");
        VerdictVault.Authorization memory a = _auth(funderPk, 10e6, vault.createNonce(p, salt), salt);

        // A submitter swaps the payee for itself: the derived nonce changes, the signature fails.
        p.payees[1] = relayer;
        vm.expectRevert("FiatTokenV2: invalid signature");
        vault.createPotWithAuthorization(p, 10e6, a);

        p = _params();
        p.refundTo = relayer;
        vm.expectRevert("FiatTokenV2: invalid signature");
        vault.createPotWithAuthorization(p, 10e6, a);

        p = _params();
        p.sharesBps[0] = 4000;
        p.sharesBps[1] = 6000;
        vm.expectRevert("FiatTokenV2: invalid signature");
        vault.createPotWithAuthorization(p, 10e6, a);
    }

    function test_createPotWithAuthorization_failureLeavesNoPot() public {
        VerdictVault.PotParams memory p = _params();
        bytes32 salt = keccak256("c1");
        VerdictVault.Authorization memory a = _auth(funderPk, 10e6, vault.createNonce(p, salt), salt);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vault.createPotWithAuthorization(p, 11e6, a);
        assertEq(vault.potCount(), 0);
    }

    function test_createPotWithAuthorization_zeroAmount() public {
        VerdictVault.PotParams memory p = _params();
        bytes32 salt = keccak256("c1");
        VerdictVault.Authorization memory a = _auth(funderPk, 0, vault.createNonce(p, salt), salt);
        vm.expectRevert(VerdictVault.ZeroAmount.selector);
        vault.createPotWithAuthorization(p, 0, a);
    }

    // ------------------------------------------------------------------ ERC-1271 multisig resolver

    uint256[3] ownerPks = [uint256(0x111), 0x222, 0x333];

    function _multisig() internal returns (MultisigResolver m, uint256[] memory sortedPks) {
        address[] memory owners = new address[](3);
        for (uint256 i; i < 3; ++i) {
            owners[i] = vm.addr(ownerPks[i]);
        }
        m = new MultisigResolver(owners, 2);
        // sort keys by address ascending
        sortedPks = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            sortedPks[i] = ownerPks[i];
        }
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (vm.addr(sortedPks[j]) < vm.addr(sortedPks[i])) {
                    (sortedPks[i], sortedPks[j]) = (sortedPks[j], sortedPks[i]);
                }
            }
        }
    }

    function _multisigPot(address res) internal returns (uint256 id) {
        VerdictVault.PotParams memory p = _params();
        id = vault.createPot(p.conditionId, res, p.payees, p.sharesBps, p.refundTo, p.deadline);
        bytes32 salt = keccak256(abi.encode("m", id));
        vault.fundWithAuthorization(id, 10e6, _auth(funderPk, 10e6, vault.fundNonce(id, salt), salt));
    }

    function test_multisig_twoOfThreeResolves() public {
        (MultisigResolver m, uint256[] memory pks) = _multisig();
        uint256 id = _multisigPot(address(m));
        bytes memory sigs = bytes.concat(_sig(pks[0], id, false), _sig(pks[2], id, false));
        vault.resolve(id, false, sigs);
        assertEq(usdc.balanceOf(refundTo), 10e6);
    }

    function test_multisig_rejectsSingleSignature() public {
        (MultisigResolver m, uint256[] memory pks) = _multisig();
        uint256 id = _multisigPot(address(m));
        bytes memory one = _sig(pks[0], id, true);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, one);
    }

    function test_multisig_rejectsDuplicateAndUnsorted() public {
        (MultisigResolver m, uint256[] memory pks) = _multisig();
        uint256 id = _multisigPot(address(m));
        bytes memory dup = bytes.concat(_sig(pks[0], id, true), _sig(pks[0], id, true));
        bytes memory unsorted = bytes.concat(_sig(pks[2], id, true), _sig(pks[0], id, true));
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, dup);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, unsorted);
    }

    function test_multisig_rejectsOutsider() public {
        (MultisigResolver m, uint256[] memory pks) = _multisig();
        uint256 id = _multisigPot(address(m));
        uint256 outsider = 0x999;
        (uint256 a, uint256 b) = vm.addr(outsider) < vm.addr(pks[0]) ? (outsider, pks[0]) : (pks[0], outsider);
        bytes memory sigs = bytes.concat(_sig(a, id, true), _sig(b, id, true));
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, sigs);
    }

    function test_multisig_signaturesBoundToOutcome() public {
        (MultisigResolver m, uint256[] memory pks) = _multisig();
        uint256 id = _multisigPot(address(m));
        bytes memory sigsForNo = bytes.concat(_sig(pks[0], id, false), _sig(pks[1], id, false));
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, sigsForNo);
    }

    function test_multisig_invalidConfig() public {
        address[] memory owners = new address[](2);
        owners[0] = alice;
        owners[1] = alice;
        vm.expectRevert(MultisigResolver.InvalidConfig.selector);
        new MultisigResolver(owners, 1);
        owners[1] = bob;
        vm.expectRevert(MultisigResolver.InvalidConfig.selector);
        new MultisigResolver(owners, 3);
        vm.expectRevert(MultisigResolver.InvalidConfig.selector);
        new MultisigResolver(owners, 0);
    }
}
