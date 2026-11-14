// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VerdictVault} from "../src/VerdictVault.sol";
import {GuaranteeBook} from "../src/GuaranteeBook.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract GuaranteeBookTest is Test {
    VerdictVault vault;
    MockUSDC usdc;
    GuaranteeBook book;

    uint256 constant RESOLVER_PK = 0xBEEF;
    address operator = makeAddr("operator");
    address merchant = makeAddr("merchant");
    bytes32 constant COND = keccak256("gemini:SOL05M:UP");
    uint128 constant REFUND = 5e6;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new VerdictVault(IERC20(address(usdc)), 1 hours);
        book = new GuaranteeBook(vault, operator);
        usdc.mint(merchant, 1_000_000e6);
        vm.prank(merchant);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _pot(uint256 fundAmount) internal returns (uint256 potId) {
        address[] memory p = new address[](1);
        uint16[] memory s = new uint16[](1);
        p[0] = address(book);
        s[0] = 10_000;
        vm.prank(merchant);
        potId = vault.createPot(COND, vm.addr(RESOLVER_PK), p, s, merchant, uint64(block.timestamp + 1 days));
        if (fundAmount > 0) {
            vm.prank(merchant);
            vault.fund(potId, fundAmount);
        }
    }

    function _open(uint256 potId, uint32 maxCustomers) internal returns (uint256 gid) {
        vm.prank(operator);
        gid = book.open(potId, REFUND, maxCustomers, uint64(block.timestamp + 12 hours));
    }

    function _customer(uint256 i) internal pure returns (address) {
        return address(uint160(0xC0000 + i));
    }

    function _enrol(uint256 gid, uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            vm.prank(operator);
            book.enrol(gid, _customer(i));
        }
    }

    function _resolve(uint256 potId, bool outcome) internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RESOLVER_PK, vault.resolutionDigest(potId, COND, outcome));
        vault.resolve(potId, outcome, abi.encodePacked(r, s, v));
    }

    // ------------------------------------------------------------------ open

    function test_open_setsTerms() public {
        uint256 potId = _pot(50e6);
        uint256 gid = _open(potId, 10);
        GuaranteeBook.Guarantee memory g = book.getGuarantee(gid);
        assertEq(g.potId, potId);
        assertEq(g.merchant, merchant);
        assertEq(g.refundAmount, REFUND);
        assertEq(g.maxCustomers, 10);
        assertEq(book.guaranteeOfPot(potId), gid);
    }

    function test_open_merchantMayOpenToo() public {
        uint256 potId = _pot(50e6);
        vm.prank(merchant);
        book.open(potId, REFUND, 10, uint64(block.timestamp + 1 hours));
    }

    function test_open_rejectsStrangersAndBadPots() public {
        uint256 potId = _pot(50e6);
        vm.expectRevert(GuaranteeBook.NotOperator.selector);
        vm.prank(makeAddr("stranger"));
        book.open(potId, REFUND, 10, uint64(block.timestamp + 1 hours));

        // pot paying someone else
        address[] memory p = new address[](1);
        uint16[] memory s = new uint16[](1);
        p[0] = makeAddr("other");
        s[0] = 10_000;
        uint256 other = vault.createPot(COND, vm.addr(RESOLVER_PK), p, s, merchant, uint64(block.timestamp + 1 days));
        vm.expectRevert(GuaranteeBook.InvalidPot.selector);
        vm.prank(operator);
        book.open(other, REFUND, 10, uint64(block.timestamp + 1 hours));
    }

    function test_open_rejectsBadTermsAndDoubleOpen() public {
        uint256 potId = _pot(50e6);
        vm.startPrank(operator);
        vm.expectRevert(GuaranteeBook.InvalidTerms.selector);
        book.open(potId, REFUND, 51, uint64(block.timestamp + 1 hours));
        vm.expectRevert(GuaranteeBook.InvalidTerms.selector);
        book.open(potId, 0, 10, uint64(block.timestamp + 1 hours));
        vm.expectRevert(GuaranteeBook.InvalidTerms.selector); // lock must be before the pot deadline
        book.open(potId, REFUND, 10, uint64(block.timestamp + 1 days));
        book.open(potId, REFUND, 10, uint64(block.timestamp + 1 hours));
        vm.expectRevert(GuaranteeBook.AlreadyOpened.selector);
        book.open(potId, REFUND, 10, uint64(block.timestamp + 1 hours));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ enrol

    function test_enrol_rules() public {
        uint256 potId = _pot(10e6); // covers 2 seats
        uint256 gid = _open(potId, 3);
        _enrol(gid, 2);
        assertEq(book.customers(gid).length, 2);
        assertTrue(book.isCustomer(gid, _customer(1)));

        vm.startPrank(operator);
        vm.expectRevert(GuaranteeBook.AlreadyEnrolled.selector);
        book.enrol(gid, _customer(0));
        vm.expectRevert(GuaranteeBook.NotCovered.selector); // seat 3 not funded yet
        book.enrol(gid, _customer(2));
        vm.stopPrank();

        vm.prank(merchant);
        vault.fund(potId, 5e6);
        _enrol(gid, 0);
        vm.prank(operator);
        book.enrol(gid, _customer(2));
        vm.expectRevert(GuaranteeBook.Full.selector);
        vm.prank(operator);
        book.enrol(gid, _customer(3));
    }

    function test_enrol_onlyOperatorAndBeforeLock() public {
        uint256 potId = _pot(50e6);
        uint256 gid = _open(potId, 10);
        vm.expectRevert(GuaranteeBook.NotOperator.selector);
        vm.prank(merchant);
        book.enrol(gid, _customer(0));
        vm.warp(book.getGuarantee(gid).lockTime);
        vm.expectRevert(GuaranteeBook.EnrolmentClosed.selector);
        vm.prank(operator);
        book.enrol(gid, _customer(0));
    }

    // ------------------------------------------------------------------ settlement

    function test_payout_exactRefundsAndLeftover() public {
        uint256 potId = _pot(50e6); // 10 seats
        uint256 gid = _open(potId, 10);
        _enrol(gid, 3);
        _resolve(potId, true);
        assertEq(usdc.balanceOf(address(book)), 50e6);

        uint256 before = usdc.balanceOf(merchant);
        book.payout(gid, 100);
        for (uint256 i; i < 3; ++i) {
            assertEq(usdc.balanceOf(_customer(i)), REFUND);
        }
        assertEq(usdc.balanceOf(merchant) - before, 35e6); // 7 unused seats
        assertEq(usdc.balanceOf(address(book)), 0);
        assertTrue(book.getGuarantee(gid).settled);
        vm.expectRevert(GuaranteeBook.AlreadySettled.selector);
        book.payout(gid, 1);
    }

    function test_payout_inBatches() public {
        uint256 potId = _pot(50e6);
        uint256 gid = _open(potId, 10);
        _enrol(gid, 5);
        _resolve(potId, true);
        assertEq(book.payout(gid, 2), 2);
        assertEq(usdc.balanceOf(_customer(1)), REFUND);
        assertEq(usdc.balanceOf(_customer(2)), 0);
        assertFalse(book.getGuarantee(gid).settled);
        assertEq(book.payout(gid, 2), 2);
        assertEq(book.payout(gid, 2), 1);
        assertTrue(book.getGuarantee(gid).settled);
        assertEq(usdc.balanceOf(address(book)), 0);
    }

    function test_payout_notTriggered() public {
        uint256 potId = _pot(50e6);
        uint256 gid = _open(potId, 10);
        _enrol(gid, 2);
        vm.expectRevert(GuaranteeBook.NotTriggered.selector); // still open
        book.payout(gid, 10);
        uint256 before = usdc.balanceOf(merchant);
        _resolve(potId, false);
        assertEq(usdc.balanceOf(merchant) - before, 50e6); // vault refunds the merchant directly
        vm.expectRevert(GuaranteeBook.NotTriggered.selector);
        book.payout(gid, 10);
        assertEq(usdc.balanceOf(address(book)), 0);
    }

    function test_payout_blocklistedCustomerIsDeferred() public {
        uint256 potId = _pot(15e6);
        uint256 gid = _open(potId, 3);
        _enrol(gid, 3);
        usdc.setBlocked(_customer(1), true);
        _resolve(potId, true);
        book.payout(gid, 10);
        assertEq(usdc.balanceOf(_customer(0)), REFUND);
        assertEq(usdc.balanceOf(_customer(2)), REFUND);
        assertEq(book.claimable(_customer(1)), REFUND);
        assertEq(usdc.balanceOf(address(book)), REFUND);
        usdc.setBlocked(_customer(1), false);
        vm.prank(_customer(1));
        book.claim();
        assertEq(usdc.balanceOf(_customer(1)), REFUND);
        assertEq(usdc.balanceOf(address(book)), 0);
    }

    function test_payout_noCustomersReturnsEverything() public {
        uint256 potId = _pot(25e6);
        uint256 gid = _open(potId, 5);
        _resolve(potId, true);
        uint256 before = usdc.balanceOf(merchant);
        book.payout(gid, 10);
        assertEq(usdc.balanceOf(merchant) - before, 25e6);
    }

    /// Whatever the number of customers and refund size, customers get exactly refund each and
    /// the merchant gets exactly the rest; the book ends empty.
    function testFuzz_payoutConservesFunds(uint8 nRaw, uint32 refundRaw, uint8 extraSeats, uint8 batch) public {
        uint32 n = uint32(bound(nRaw, 0, 50));
        uint128 refund = uint128(bound(refundRaw, 1, 1_000e6));
        uint32 maxC = uint32(bound(uint256(n) + extraSeats, n == 0 ? 1 : n, 50));
        uint256 funded = uint256(refund) * maxC;
        uint256 potId = _pot(funded);
        vm.prank(operator);
        uint256 gid = book.open(potId, refund, maxC, uint64(block.timestamp + 1 hours));
        for (uint256 i; i < n; ++i) {
            vm.prank(operator);
            book.enrol(gid, _customer(i));
        }
        _resolve(potId, true);
        uint256 before = usdc.balanceOf(merchant);
        uint256 step = bound(batch, 1, 60);
        while (!book.getGuarantee(gid).settled) book.payout(gid, step);
        for (uint256 i; i < n; ++i) {
            assertEq(usdc.balanceOf(_customer(i)), refund);
        }
        assertEq(usdc.balanceOf(merchant) - before, funded - uint256(n) * refund);
        assertEq(usdc.balanceOf(address(book)), 0);
    }
}
