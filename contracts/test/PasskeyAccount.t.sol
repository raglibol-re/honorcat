// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {PasskeyAccount} from "../src/passkey/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/passkey/PasskeyAccountFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// WebAuthn assertions are built exactly as a browser does: authenticatorData (rpIdHash | flags |
/// signCount), clientDataJSON with type and base64url challenge, and a P-256 signature over
/// sha256(authenticatorData || sha256(clientDataJSON)).
contract PasskeyAccountTest is Test {
    uint256 constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 constant PK = 0xA11CE5;
    uint256 constant OTHER_PK = 0xB0B;
    bytes32 RP = sha256("verdict-phi-livid.vercel.app");

    PasskeyAccountFactory factory;
    PasskeyAccount account;
    MockUSDC usdc;
    bytes32 qx;
    bytes32 qy;
    address dest = makeAddr("dest");

    function setUp() public {
        factory = new PasskeyAccountFactory();
        usdc = new MockUSDC();
        (uint256 x, uint256 y) = vm.publicKeyP256(PK);
        (qx, qy) = (bytes32(x), bytes32(y));
        account = PasskeyAccount(payable(factory.createAccount(qx, qy, RP)));
        usdc.mint(address(account), 100e6);
    }

    // ------------------------------------------------------------------ helpers

    function _assert(uint256 pk, bytes32 challenge, bytes32 rpIdHash, bytes1 flags, string memory type_)
        internal
        pure
        returns (WebAuthn.WebAuthnAuth memory a)
    {
        a.authenticatorData = abi.encodePacked(rpIdHash, flags, uint32(1));
        a.clientDataJSON = string.concat(
            '{"type":"',
            type_,
            '","challenge":"',
            Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"https://verdict-phi-livid.vercel.app"}'
        );
        a.typeIndex = 1;
        a.challengeIndex = 11 + bytes(type_).length; // {"type":"<type>","challenge":... -> index of "challenge"
        bytes32 h = sha256(abi.encodePacked(a.authenticatorData, sha256(bytes(a.clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(pk, h);
        if (uint256(s) > N / 2) s = bytes32(N - uint256(s)); // browsers may return high-s; normalise
        (a.r, a.s) = (r, s);
    }

    function _good(bytes32 challenge) internal view returns (WebAuthn.WebAuthnAuth memory) {
        return _assert(PK, challenge, RP, 0x05, "webauthn.get"); // UP | UV
    }

    /// ERC-1271 signature format: the six WebAuthnAuth fields ABI-encoded flat (no outer offset).
    function _sig(WebAuthn.WebAuthnAuth memory a) internal pure returns (bytes memory) {
        return abi.encode(a.r, a.s, a.challengeIndex, a.typeIndex, a.authenticatorData, a.clientDataJSON);
    }

    function _transfer(uint256 amount) internal view returns (bytes memory) {
        return abi.encodeCall(usdc.transfer, (dest, amount));
    }

    function _exec(WebAuthn.WebAuthnAuth memory a, uint256 amount, uint64 deadline) internal {
        account.execute(address(usdc), 0, _transfer(amount), deadline, a);
    }

    // ------------------------------------------------------------------ tests

    function test_factory_isDeterministicAndIdempotent() public {
        assertEq(factory.accountAddress(qx, qy, RP), address(account));
        assertEq(factory.createAccount(qx, qy, RP), address(account));
        assertEq(account.qx(), qx);
        assertEq(account.rpIdHash(), RP);
        // the implementation and an initialised clone cannot be (re)initialised
        vm.expectRevert(PasskeyAccount.AlreadyInitialized.selector);
        account.initialize(qx, qy, RP);
        PasskeyAccount impl = factory.implementation();
        vm.expectRevert(PasskeyAccount.AlreadyInitialized.selector);
        impl.initialize(qx, qy, RP);
    }

    function test_execute_validSignature_anyoneSubmits() public {
        uint64 deadline = uint64(block.timestamp + 600);
        bytes32 d = account.executeDigest(address(usdc), 0, _transfer(40e6), deadline);
        WebAuthn.WebAuthnAuth memory a = _good(d);
        vm.prank(makeAddr("relay"));
        _exec(a, 40e6, deadline);
        assertEq(usdc.balanceOf(dest), 40e6);
        assertEq(account.nonce(), 1);
    }

    function test_execute_replayRejected() public {
        uint64 deadline = uint64(block.timestamp + 600);
        WebAuthn.WebAuthnAuth memory a = _good(account.executeDigest(address(usdc), 0, _transfer(1e6), deadline));
        _exec(a, 1e6, deadline);
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector); // nonce moved on
        _exec(a, 1e6, deadline);
    }

    function test_execute_wrongKey() public {
        uint64 deadline = uint64(block.timestamp + 600);
        bytes32 d = account.executeDigest(address(usdc), 0, _transfer(1e6), deadline);
        WebAuthn.WebAuthnAuth memory a = _assert(OTHER_PK, d, RP, 0x05, "webauthn.get");
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector);
        _exec(a, 1e6, deadline);
    }

    function test_execute_signatureBoundToCall() public {
        uint64 deadline = uint64(block.timestamp + 600);
        WebAuthn.WebAuthnAuth memory a = _good(account.executeDigest(address(usdc), 0, _transfer(1e6), deadline));
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector); // different amount
        _exec(a, 2e6, deadline);
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector); // different deadline
        _exec(a, 1e6, deadline + 1);
    }

    function test_execute_expired() public {
        uint64 deadline = uint64(block.timestamp + 60);
        WebAuthn.WebAuthnAuth memory a = _good(account.executeDigest(address(usdc), 0, _transfer(1e6), deadline));
        vm.warp(deadline + 1);
        vm.expectRevert(PasskeyAccount.Expired.selector);
        _exec(a, 1e6, deadline);
    }

    function test_malformed_wrongRpId() public {
        uint64 deadline = uint64(block.timestamp + 600);
        bytes32 d = account.executeDigest(address(usdc), 0, _transfer(1e6), deadline);
        WebAuthn.WebAuthnAuth memory a = _assert(PK, d, sha256("evil.example"), 0x05, "webauthn.get");
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector);
        _exec(a, 1e6, deadline);
    }

    function test_malformed_missingUserVerification() public {
        uint64 deadline = uint64(block.timestamp + 600);
        bytes32 d = account.executeDigest(address(usdc), 0, _transfer(1e6), deadline);
        WebAuthn.WebAuthnAuth memory a = _assert(PK, d, RP, 0x01, "webauthn.get"); // UP only
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector);
        _exec(a, 1e6, deadline);
    }

    function test_malformed_registrationTypeRejected() public {
        uint64 deadline = uint64(block.timestamp + 600);
        bytes32 d = account.executeDigest(address(usdc), 0, _transfer(1e6), deadline);
        WebAuthn.WebAuthnAuth memory a = _assert(PK, d, RP, 0x05, "webauthn.create");
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector);
        _exec(a, 1e6, deadline);
    }

    function test_malformed_tamperedClientData() public {
        uint64 deadline = uint64(block.timestamp + 600);
        bytes32 d = account.executeDigest(address(usdc), 0, _transfer(1e6), deadline);
        WebAuthn.WebAuthnAuth memory a = _good(d);
        a.clientDataJSON = string.concat(a.clientDataJSON, " "); // signature no longer covers it
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector);
        _exec(a, 1e6, deadline);
        a = _good(d);
        a.challengeIndex += 1; // points at the wrong place
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector);
        _exec(a, 1e6, deadline);
        a = _good(d);
        a.authenticatorData = hex"00"; // too short
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector);
        _exec(a, 1e6, deadline);
    }

    function test_malformed_highS() public {
        uint64 deadline = uint64(block.timestamp + 600);
        bytes32 d = account.executeDigest(address(usdc), 0, _transfer(1e6), deadline);
        WebAuthn.WebAuthnAuth memory a = _good(d);
        a.s = bytes32(N - uint256(a.s)); // the malleable twin of a valid signature
        vm.expectRevert(PasskeyAccount.InvalidSignature.selector);
        _exec(a, 1e6, deadline);
    }

    function test_erc1271() public view {
        bytes32 h = keccak256("Join HonorCat guarantee abc as me");
        assertEq(account.isValidSignature(h, _sig(_good(h))), bytes4(0x1626ba7e));
        assertEq(account.isValidSignature(h, _sig(_assert(OTHER_PK, h, RP, 0x05, "webauthn.get"))), bytes4(0xffffffff));
        assertEq(account.isValidSignature(keccak256("other"), _sig(_good(h))), bytes4(0xffffffff));
        assertEq(account.isValidSignature(h, hex"1234"), bytes4(0xffffffff));
    }

    function test_failedCallRevertsWholeExecute() public {
        uint64 deadline = uint64(block.timestamp + 600);
        bytes memory data = _transfer(1_000e6); // more than the balance
        WebAuthn.WebAuthnAuth memory a = _good(account.executeDigest(address(usdc), 0, data, deadline));
        vm.expectRevert();
        account.execute(address(usdc), 0, data, deadline, a);
        assertEq(account.nonce(), 0); // nothing consumed
    }
}
