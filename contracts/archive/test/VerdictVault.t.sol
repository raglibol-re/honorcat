// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {VerdictVault} from "../src/VerdictVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract VerdictVaultTest is Test {
    VerdictVault vault;
    MockUSDC usdc;

    uint256 constant GRACE = 1 hours;
    bytes32 constant COND = keccak256("manual:demo-1");

    uint256 resolverPk = 0xA11CE;
    address resolver;
    uint256 attackerPk = 0xBAD;

    address funder = makeAddr("funder");
    address funder2 = makeAddr("funder2");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address refundTo = makeAddr("refundTo");
    address relayer = makeAddr("relayer");

    event PotFunded(uint256 indexed potId, address indexed funder, uint256 amount, uint256 newTotal);
    event PotResolved(uint256 indexed potId, bool outcome, uint256 total, address indexed submitter);
    event PotExpired(uint256 indexed potId, uint256 total);
    event Payout(uint256 indexed potId, address indexed payee, uint256 amount);
    event Refund(uint256 indexed potId, address indexed refundTo, uint256 amount);
    event PaymentDeferred(
        uint256 indexed potId, address indexed recipient, uint256 amount, VerdictVault.PaymentKind kind
    );
    event Claimed(address indexed account, uint256 amount);

    function setUp() public {
        resolver = vm.addr(resolverPk);
        usdc = new MockUSDC();
        vault = new VerdictVault(IERC20(address(usdc)), GRACE);
        _mintApprove(funder, 1_000_000e6);
        _mintApprove(funder2, 1_000_000e6);
    }

    // ------------------------------------------------------------------ helpers

    function _mintApprove(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _twoPayees() internal view returns (address[] memory p, uint16[] memory s) {
        p = new address[](2);
        s = new uint16[](2);
        (p[0], p[1]) = (alice, bob);
        (s[0], s[1]) = (7000, 3000);
    }

    function _create() internal returns (uint256) {
        (address[] memory p, uint16[] memory s) = _twoPayees();
        return vault.createPot(COND, resolver, p, s, refundTo, uint64(block.timestamp + 1 days));
    }

    function _createFunded(uint256 amount) internal returns (uint256 id) {
        id = _create();
        vm.prank(funder);
        vault.fund(id, amount);
    }

    function _sign(uint256 pk, VerdictVault v, uint256 potId, bytes32 cond, bool outcome)
        internal
        view
        returns (bytes memory)
    {
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(pk, v.resolutionDigest(potId, cond, outcome));
        return abi.encodePacked(r, s, vv);
    }

    function _deadline(uint256 id) internal view returns (uint256) {
        return vault.getPot(id).deadline;
    }

    // ------------------------------------------------------------------ createPot

    function test_createPot_storesFields() public {
        uint256 id = _create();
        assertEq(id, 1);
        VerdictVault.Pot memory p = vault.getPot(id);
        assertEq(p.conditionId, COND);
        assertEq(p.resolver, resolver);
        assertEq(p.refundTo, refundTo);
        assertEq(uint8(p.status), uint8(VerdictVault.Status.Open));
        assertEq(p.payees.length, 2);
        assertEq(p.sharesBps[0], 7000);
        assertEq(p.total, 0);
    }

    function test_createPot_revertsOnBadShares() public {
        (address[] memory p, uint16[] memory s) = _twoPayees();
        s[1] = 2999;
        vm.expectRevert(VerdictVault.InvalidShares.selector);
        vault.createPot(COND, resolver, p, s, refundTo, uint64(block.timestamp + 1));

        s[0] = 10_000;
        s[1] = 0;
        vm.expectRevert(VerdictVault.InvalidShares.selector);
        vault.createPot(COND, resolver, p, s, refundTo, uint64(block.timestamp + 1));
    }

    function test_createPot_revertsOnBadPayees() public {
        (address[] memory p, uint16[] memory s) = _twoPayees();
        uint16[] memory one = new uint16[](1);
        one[0] = 10_000;
        vm.expectRevert(VerdictVault.InvalidPayees.selector);
        vault.createPot(COND, resolver, p, one, refundTo, uint64(block.timestamp + 1));

        vm.expectRevert(VerdictVault.InvalidPayees.selector);
        vault.createPot(COND, resolver, new address[](0), new uint16[](0), refundTo, uint64(block.timestamp + 1));

        p[1] = address(0);
        vm.expectRevert(VerdictVault.ZeroAddress.selector);
        vault.createPot(COND, resolver, p, s, refundTo, uint64(block.timestamp + 1));

        address[] memory many = new address[](21);
        uint16[] memory manyS = new uint16[](21);
        vm.expectRevert(VerdictVault.InvalidPayees.selector);
        vault.createPot(COND, resolver, many, manyS, refundTo, uint64(block.timestamp + 1));
    }

    function test_createPot_revertsOnZeroResolverOrRefund() public {
        (address[] memory p, uint16[] memory s) = _twoPayees();
        vm.expectRevert(VerdictVault.ZeroAddress.selector);
        vault.createPot(COND, address(0), p, s, refundTo, uint64(block.timestamp + 1));
        vm.expectRevert(VerdictVault.ZeroAddress.selector);
        vault.createPot(COND, resolver, p, s, address(0), uint64(block.timestamp + 1));
    }

    function test_createPot_revertsOnPastDeadline() public {
        (address[] memory p, uint16[] memory s) = _twoPayees();
        vm.expectRevert(VerdictVault.DeadlineInPast.selector);
        vault.createPot(COND, resolver, p, s, refundTo, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------ fund

    function test_fund_multipleFundersAndTopUps() public {
        uint256 id = _create();
        vm.expectEmit(address(vault));
        emit PotFunded(id, funder, 100e6, 100e6);
        vm.prank(funder);
        vault.fund(id, 100e6);

        vm.expectEmit(address(vault));
        emit PotFunded(id, funder2, 50e6, 150e6);
        vm.prank(funder2);
        vault.fund(id, 50e6);

        vm.prank(funder);
        vault.fund(id, 1);

        assertEq(vault.getPot(id).total, 150e6 + 1);
        assertEq(usdc.balanceOf(address(vault)), 150e6 + 1);
    }

    function test_fund_revertsOnZeroAmount() public {
        uint256 id = _create();
        vm.prank(funder);
        vm.expectRevert(VerdictVault.ZeroAmount.selector);
        vault.fund(id, 0);
    }

    function test_fund_revertsOnUnknownPot() public {
        vm.prank(funder);
        vm.expectRevert(VerdictVault.PotNotOpen.selector);
        vault.fund(42, 1e6);
    }

    function test_fund_revertsAfterDeadline() public {
        uint256 id = _create();
        vm.warp(_deadline(id)); // deadline itself is still allowed
        vm.prank(funder);
        vault.fund(id, 1e6);

        vm.warp(_deadline(id) + 1);
        vm.prank(funder);
        vm.expectRevert(VerdictVault.FundingClosed.selector);
        vault.fund(id, 1e6);
    }

    function test_fund_revertsAfterResolve() public {
        uint256 id = _createFunded(10e6);
        vault.resolve(id, true, _sign(resolverPk, vault, id, COND, true));
        vm.prank(funder);
        vm.expectRevert(VerdictVault.PotNotOpen.selector);
        vault.fund(id, 1e6);
    }

    function test_fund_revertsWithoutAllowance() public {
        uint256 id = _create();
        address poor = makeAddr("poor");
        usdc.mint(poor, 10e6);
        vm.prank(poor);
        vm.expectRevert();
        vault.fund(id, 10e6);
    }

    // ------------------------------------------------------------------ resolve: outcomes

    function test_resolve_true_paysPayeesByShare() public {
        uint256 id = _createFunded(100e6);
        bytes memory sig = _sign(resolverPk, vault, id, COND, true);

        vm.expectEmit(address(vault));
        emit PotResolved(id, true, 100e6, relayer);
        vm.expectEmit(address(vault));
        emit Payout(id, alice, 70e6);
        vm.expectEmit(address(vault));
        emit Payout(id, bob, 30e6);

        vm.prank(relayer); // anyone may submit
        vault.resolve(id, true, sig);

        assertEq(usdc.balanceOf(alice), 70e6);
        assertEq(usdc.balanceOf(bob), 30e6);
        assertEq(usdc.balanceOf(refundTo), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
        VerdictVault.Pot memory p = vault.getPot(id);
        assertEq(uint8(p.status), uint8(VerdictVault.Status.Resolved));
        assertTrue(p.outcome);
    }

    function test_resolve_false_refunds() public {
        uint256 id = _createFunded(100e6);

        bytes memory sig = _sign(resolverPk, vault, id, COND, false);
        vm.expectEmit(address(vault));
        emit PotResolved(id, false, 100e6, address(this));
        vm.expectEmit(address(vault));
        emit Refund(id, refundTo, 100e6);

        vault.resolve(id, false, sig);

        assertEq(usdc.balanceOf(refundTo), 100e6);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertFalse(vault.getPot(id).outcome);
    }

    function test_resolve_allowedDuringGrace() public {
        uint256 id = _createFunded(10e6);
        vm.warp(_deadline(id) + GRACE);
        vault.resolve(id, true, _sign(resolverPk, vault, id, COND, true));
        assertEq(usdc.balanceOf(alice), 7e6);
    }

    function test_resolve_revertsAfterGrace() public {
        uint256 id = _createFunded(10e6);
        bytes memory sig = _sign(resolverPk, vault, id, COND, true);
        vm.warp(_deadline(id) + GRACE + 1);
        vm.expectRevert(VerdictVault.ResolutionWindowClosed.selector);
        vault.resolve(id, true, sig);
    }

    // ------------------------------------------------------------------ resolve: signature security

    function test_resolve_revertsOnWrongSigner() public {
        uint256 id = _createFunded(10e6);
        bytes memory sig = _sign(attackerPk, vault, id, COND, true);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, sig);
    }

    function test_resolve_revertsOnFlippedOutcome() public {
        uint256 id = _createFunded(10e6);
        bytes memory sigForFalse = _sign(resolverPk, vault, id, COND, false);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, sigForFalse);
    }

    function test_resolve_revertsOnWrongConditionId() public {
        uint256 id = _createFunded(10e6);
        bytes memory sig = _sign(resolverPk, vault, id, keccak256("other"), true);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, sig);
    }

    function test_resolve_revertsOnMalformedSignature() public {
        uint256 id = _createFunded(10e6);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, hex"1234");
    }

    function test_resolve_replay_otherPotSameCondition() public {
        uint256 id1 = _createFunded(10e6);
        uint256 id2 = _createFunded(10e6); // same resolver and conditionId
        bytes memory sig1 = _sign(resolverPk, vault, id1, COND, true);
        vault.resolve(id1, true, sig1);

        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id2, true, sig1);
    }

    function test_resolve_replay_otherContract() public {
        VerdictVault other = new VerdictVault(IERC20(address(usdc)), GRACE);
        vm.prank(funder);
        usdc.approve(address(other), type(uint256).max);
        (address[] memory p, uint16[] memory s) = _twoPayees();
        uint256 idA = _createFunded(10e6);
        uint256 idB = other.createPot(COND, resolver, p, s, refundTo, uint64(block.timestamp + 1 days));
        vm.prank(funder);
        other.fund(idB, 10e6);
        assertEq(idA, idB);

        bytes memory sigA = _sign(resolverPk, vault, idA, COND, true);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        other.resolve(idB, true, sigA);
    }

    function test_resolve_replay_otherChain() public {
        uint256 id = _createFunded(10e6);
        bytes memory sig = _sign(resolverPk, vault, id, COND, true);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(VerdictVault.InvalidSignature.selector);
        vault.resolve(id, true, sig);
    }

    function test_resolve_revertsOnDoubleResolve() public {
        uint256 id = _createFunded(10e6);
        bytes memory sig = _sign(resolverPk, vault, id, COND, true);
        vault.resolve(id, true, sig);

        vm.expectRevert(VerdictVault.PotNotOpen.selector);
        vault.resolve(id, true, sig);

        bytes memory sigFalse = _sign(resolverPk, vault, id, COND, false);
        vm.expectRevert(VerdictVault.PotNotOpen.selector);
        vault.resolve(id, false, sigFalse);
    }

    // ------------------------------------------------------------------ unfunded / unknown pots

    function test_resolve_revertsOnUnfundedPot() public {
        uint256 id = _create();
        bytes memory sig = _sign(resolverPk, vault, id, COND, true);
        vm.expectRevert(VerdictVault.NotFunded.selector);
        vault.resolve(id, true, sig);
    }

    function test_resolve_revertsOnUnknownPot() public {
        bytes memory sig = _sign(resolverPk, vault, 99, COND, true);
        vm.expectRevert(VerdictVault.PotNotOpen.selector);
        vault.resolve(99, true, sig);
    }

    function test_expire_unfundedPotClosesWithoutTransfer() public {
        uint256 id = _create();
        vm.warp(_deadline(id) + GRACE + 1);
        vm.expectEmit(address(vault));
        emit PotExpired(id, 0);
        vault.expire(id);
        assertEq(uint8(vault.getPot(id).status), uint8(VerdictVault.Status.Expired));
        assertEq(usdc.balanceOf(refundTo), 0);
    }

    // ------------------------------------------------------------------ expire

    function test_expire_refundsAfterGrace() public {
        uint256 id = _createFunded(100e6);
        vm.prank(funder2);
        vault.fund(id, 5e6);

        vm.warp(_deadline(id) + GRACE);
        vm.expectRevert(VerdictVault.NotExpirable.selector);
        vault.expire(id);

        vm.warp(_deadline(id) + GRACE + 1);
        vm.expectEmit(address(vault));
        emit PotExpired(id, 105e6);
        vm.expectEmit(address(vault));
        emit Refund(id, refundTo, 105e6);
        vault.expire(id);

        assertEq(usdc.balanceOf(refundTo), 105e6);
        assertEq(usdc.balanceOf(address(vault)), 0);

        vm.expectRevert(VerdictVault.PotNotOpen.selector);
        vault.expire(id);
    }

    function test_expire_revertsAfterResolve() public {
        uint256 id = _createFunded(10e6);
        vault.resolve(id, false, _sign(resolverPk, vault, id, COND, false));
        vm.warp(_deadline(id) + GRACE + 1);
        vm.expectRevert(VerdictVault.PotNotOpen.selector);
        vault.expire(id);
    }

    // ------------------------------------------------------------------ rounding

    function test_rounding_lastPayeeGetsRemainder() public {
        address[] memory p = new address[](3);
        uint16[] memory s = new uint16[](3);
        (p[0], p[1], p[2]) = (alice, bob, carol);
        (s[0], s[1], s[2]) = (3333, 3333, 3334);
        uint256 id = vault.createPot(COND, resolver, p, s, refundTo, uint64(block.timestamp + 1 days));
        vm.prank(funder);
        vault.fund(id, 100); // 0.0001 USDC

        vault.resolve(id, true, _sign(resolverPk, vault, id, COND, true));
        assertEq(usdc.balanceOf(alice), 33);
        assertEq(usdc.balanceOf(bob), 33);
        assertEq(usdc.balanceOf(carol), 34);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_rounding_tinyPotSkipsZeroPayouts() public {
        uint256 id = _createFunded(1); // 7000 bps of 1 = 0
        vault.resolve(id, true, _sign(resolverPk, vault, id, COND, true));
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(bob), 1);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testFuzz_rounding_noDust(uint256 amount, uint8 nRaw, uint256 seed) public {
        amount = bound(amount, 1, 1_000_000e6);
        uint256 n = bound(nRaw, 1, vault.MAX_PAYEES());
        address[] memory p = new address[](n);
        uint16[] memory s = new uint16[](n);
        uint256 left = 10_000;
        for (uint256 i; i < n; ++i) {
            p[i] = address(uint160(0x1000 + i));
            if (i == n - 1) {
                s[i] = uint16(left);
            } else {
                uint256 maxShare = left - (n - 1 - i); // leave >=1 bps for each remaining payee
                s[i] = uint16(bound(uint256(keccak256(abi.encode(seed, i))), 1, maxShare));
                left -= s[i];
            }
        }
        uint256 id = vault.createPot(COND, resolver, p, s, refundTo, uint64(block.timestamp + 1 days));
        vm.prank(funder);
        vault.fund(id, amount);
        vault.resolve(id, true, _sign(resolverPk, vault, id, COND, true));

        uint256 paid;
        for (uint256 i; i < n; ++i) {
            uint256 bal = usdc.balanceOf(p[i]);
            if (i < n - 1) assertEq(bal, amount * s[i] / 10_000);
            paid += bal;
        }
        assertEq(paid, amount);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    // ------------------------------------------------------------------ deferred payments / claim

    function test_blockedPayee_isDeferredOthersPaid() public {
        uint256 id = _createFunded(100e6);
        usdc.setBlocked(alice, true);

        bytes memory sig = _sign(resolverPk, vault, id, COND, true);
        vm.expectEmit(address(vault));
        emit PaymentDeferred(id, alice, 70e6, VerdictVault.PaymentKind.Payout);
        vm.expectEmit(address(vault));
        emit Payout(id, bob, 30e6);
        vault.resolve(id, true, sig);

        assertEq(usdc.balanceOf(bob), 30e6);
        assertEq(vault.claimable(alice), 70e6);
        assertEq(vault.totalClaimable(), 70e6);
        assertEq(usdc.balanceOf(address(vault)), 70e6);

        // Still blocked: claim reverts and the credit is preserved.
        vm.prank(alice);
        vm.expectRevert();
        vault.claim();
        assertEq(vault.claimable(alice), 70e6);

        usdc.setBlocked(alice, false);
        vm.expectEmit(address(vault));
        emit Claimed(alice, 70e6);
        vm.prank(alice);
        vault.claim();
        assertEq(usdc.balanceOf(alice), 70e6);
        assertEq(vault.claimable(alice), 0);
        assertEq(vault.totalClaimable(), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);

        vm.prank(alice);
        vm.expectRevert(VerdictVault.NothingToClaim.selector);
        vault.claim();
    }

    function test_blockedRefund_isDeferred() public {
        uint256 id = _createFunded(100e6);
        usdc.setBlocked(refundTo, true);
        bytes memory sig = _sign(resolverPk, vault, id, COND, false);
        vm.expectEmit(address(vault));
        emit PaymentDeferred(id, refundTo, 100e6, VerdictVault.PaymentKind.Refund);
        vault.resolve(id, false, sig);
        assertEq(uint8(vault.getPot(id).status), uint8(VerdictVault.Status.Resolved));
        assertEq(vault.claimable(refundTo), 100e6);

        usdc.setBlocked(refundTo, false);
        vm.prank(refundTo);
        vault.claim();
        assertEq(usdc.balanceOf(refundTo), 100e6);
    }

    function test_blockedRefundOnExpire_isDeferred() public {
        uint256 id = _createFunded(10e6);
        usdc.setBlocked(refundTo, true);
        vm.warp(_deadline(id) + GRACE + 1);
        vault.expire(id);
        assertEq(vault.claimable(refundTo), 10e6);
    }

    function test_claim_revertsWhenNothing() public {
        vm.expectRevert(VerdictVault.NothingToClaim.selector);
        vault.claim();
    }

    // ------------------------------------------------------------------ misc

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(VerdictVault.ZeroAddress.selector);
        new VerdictVault(IERC20(address(0)), GRACE);
    }

    function test_digestMatchesManualEip712() public view {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("VerdictVault"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );
        bytes32 structHash = keccak256(abi.encode(vault.RESOLUTION_TYPEHASH(), uint256(1), COND, true));
        assertEq(vault.resolutionDigest(1, COND, true), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }
}
