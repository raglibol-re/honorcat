// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VerdictVault} from "../src/VerdictVault.sol";
import {MerkleBook} from "../src/MerkleBook.sol";
import {GuaranteeBook} from "../src/GuaranteeBook.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Builds OpenZeppelin-compatible trees (commutative pair hashing, double-hashed leaves).
library Tree {
    function leaf(uint256 index, address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// All layers, leaves first. An odd node is carried up unchanged.
    function layers(bytes32[] memory leaves) internal pure returns (bytes32[][] memory out) {
        uint256 depth = 1;
        for (uint256 n = leaves.length; n > 1; n = (n + 1) / 2) ++depth;
        out = new bytes32[][](depth);
        out[0] = leaves;
        for (uint256 d = 1; d < depth; ++d) {
            bytes32[] memory prev = out[d - 1];
            bytes32[] memory next = new bytes32[]((prev.length + 1) / 2);
            for (uint256 i; i < next.length; ++i) {
                next[i] = 2 * i + 1 < prev.length ? hashPair(prev[2 * i], prev[2 * i + 1]) : prev[2 * i];
            }
            out[d] = next;
        }
    }

    function root(bytes32[][] memory l) internal pure returns (bytes32) {
        return l[l.length - 1][0];
    }

    function proof(bytes32[][] memory l, uint256 index) internal pure returns (bytes32[] memory p) {
        bytes32[] memory tmp = new bytes32[](l.length);
        uint256 n;
        for (uint256 d; d < l.length - 1; ++d) {
            uint256 sib = index ^ 1;
            if (sib < l[d].length) tmp[n++] = l[d][sib];
            index >>= 1;
        }
        p = new bytes32[](n);
        for (uint256 i; i < n; ++i) p[i] = tmp[i];
    }
}

contract MerkleBookTest is Test {
    VerdictVault vault;
    MockUSDC usdc;
    MerkleBook book;

    uint256 constant RESOLVER_PK = 0xBEEF;
    address operator = makeAddr("operator");
    address funder = makeAddr("funder");
    bytes32 constant COND = keccak256("gemini:WXHIGH:YES");
    uint64 deadline;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new VerdictVault(IERC20(address(usdc)), 1 hours);
        book = new MerkleBook(vault, operator);
        usdc.mint(funder, 10_000_000e6);
        vm.prank(funder);
        usdc.approve(address(vault), type(uint256).max);
        deadline = uint64(block.timestamp + 1 days);
    }

    // ------------------------------------------------------------------ helpers

    function _account(uint256 i) internal pure returns (address) {
        return address(uint160(0xA0000 + i));
    }

    function _amount(uint256 i) internal pure returns (uint256) {
        return 1e6 + (i % 7) * 1e5; // 1.0 .. 1.6 USDC
    }

    function _tree(uint256 n) internal pure returns (bytes32[][] memory l, uint256 total) {
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            leaves[i] = Tree.leaf(i, _account(i), _amount(i));
            total += _amount(i);
        }
        l = Tree.layers(leaves);
    }

    function _pot(uint256 fundAmount) internal returns (uint256 potId) {
        address[] memory p = new address[](1);
        uint16[] memory s = new uint16[](1);
        p[0] = address(book);
        s[0] = 10_000;
        vm.prank(funder);
        potId = vault.createPot(COND, vm.addr(RESOLVER_PK), p, s, funder, deadline);
        if (fundAmount > 0) {
            vm.prank(funder);
            vault.fund(potId, fundAmount);
        }
    }

    function _lock() internal view returns (uint64) {
        return uint64(block.timestamp + 12 hours);
    }

    function _claimDeadline() internal view returns (uint64) {
        return deadline + 1 hours + 7 days;
    }

    function _drop(uint256 n, uint256 extra) internal returns (uint256 dropId, uint256 potId, bytes32[][] memory l, uint256 total) {
        (l, total) = _tree(n);
        potId = _pot(total + extra);
        vm.prank(funder);
        dropId = book.open(potId, _lock(), _claimDeadline(), Tree.root(l), total);
    }

    function _resolve(uint256 potId, bool outcome) internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RESOLVER_PK, vault.resolutionDigest(potId, COND, outcome));
        vault.resolve(potId, outcome, abi.encodePacked(r, s, v));
    }

    function _claim(uint256 dropId, bytes32[][] memory l, uint256 i) internal {
        book.claim(dropId, i, _account(i), _amount(i), Tree.proof(l, i));
    }

    // ------------------------------------------------------------------ open / root

    function test_open_setsDropAndRoot() public {
        (uint256 dropId, uint256 potId, bytes32[][] memory l, uint256 total) = _drop(10, 0);
        MerkleBook.Drop memory d = book.getDrop(dropId);
        assertEq(d.potId, potId);
        assertEq(d.funder, funder);
        assertEq(d.root, Tree.root(l));
        assertEq(d.rootTotal, total);
        assertEq(d.version, 1);
        assertEq(book.dropOfPot(potId), dropId);
    }

    function test_open_rejectsStrangersBadPotsAndTimes() public {
        uint256 potId = _pot(10e6);
        vm.expectRevert(MerkleBook.NotAuthorized.selector);
        vm.prank(makeAddr("stranger"));
        book.open(potId, _lock(), _claimDeadline(), bytes32(0), 0);

        vm.startPrank(funder);
        vm.expectRevert(MerkleBook.InvalidTimes.selector); // lock at/after pot deadline
        book.open(potId, deadline, _claimDeadline(), bytes32(0), 0);
        vm.expectRevert(MerkleBook.InvalidTimes.selector); // claims could close before last resolution
        book.open(potId, _lock(), deadline + 1 hours, bytes32(0), 0);
        book.open(potId, _lock(), _claimDeadline(), bytes32(0), 0);
        vm.expectRevert(MerkleBook.AlreadyOpened.selector);
        book.open(potId, _lock(), _claimDeadline(), bytes32(0), 0);
        vm.stopPrank();

        // a pot that pays someone else
        address[] memory p = new address[](1);
        uint16[] memory s = new uint16[](1);
        p[0] = makeAddr("other");
        s[0] = 10_000;
        vm.prank(funder);
        uint256 other = vault.createPot(COND, vm.addr(RESOLVER_PK), p, s, funder, deadline);
        vm.expectRevert(MerkleBook.InvalidPot.selector);
        vm.prank(operator);
        book.open(other, _lock(), _claimDeadline(), bytes32(0), 0);
    }

    function test_setRoot_replaceUntilLock_thenLocked() public {
        (uint256 dropId,,,) = _drop(10, 0);
        (bytes32[][] memory l2, uint256 total2) = _tree(5);
        vm.expectEmit(true, false, false, true);
        emit MerkleBook.RootSet(dropId, Tree.root(l2), total2, 2);
        vm.prank(operator);
        book.setRoot(dropId, Tree.root(l2), total2);
        assertEq(book.getDrop(dropId).version, 2);

        vm.expectRevert(MerkleBook.NotAuthorized.selector);
        vm.prank(makeAddr("stranger"));
        book.setRoot(dropId, bytes32(uint256(1)), 1);

        vm.warp(_lock());
        vm.expectRevert(MerkleBook.RootLocked.selector);
        vm.prank(funder);
        book.setRoot(dropId, bytes32(uint256(1)), 1);
    }

    function test_setRoot_lockedOnceResolved() public {
        (uint256 dropId, uint256 potId,, uint256 total) = _drop(10, 0);
        _resolve(potId, true); // even before lockTime, a resolved pot freezes the root
        vm.expectRevert(MerkleBook.RootLocked.selector);
        vm.prank(funder);
        book.setRoot(dropId, bytes32(uint256(1)), total);
    }

    function test_setRoot_rejectsOverAllocation() public {
        (uint256 dropId,,, uint256 total) = _drop(10, 0);
        vm.expectRevert(MerkleBook.OverAllocated.selector);
        vm.prank(funder);
        book.setRoot(dropId, bytes32(uint256(1)), total + 1);
    }

    // ------------------------------------------------------------------ claims

    function test_claim_validProofsPayEveryone_anyoneMaySubmit() public {
        (uint256 dropId, uint256 potId, bytes32[][] memory l, uint256 total) = _drop(37, 0);
        _resolve(potId, true);
        assertEq(usdc.balanceOf(address(book)), total);
        vm.startPrank(makeAddr("relay")); // a third party submits; money goes to the account
        for (uint256 i; i < 37; ++i) _claim(dropId, l, i);
        vm.stopPrank();
        for (uint256 i; i < 37; ++i) {
            assertEq(usdc.balanceOf(_account(i)), _amount(i));
            assertTrue(book.isClaimed(dropId, i));
        }
        assertEq(usdc.balanceOf(address(book)), 0);
        assertEq(book.getDrop(dropId).claimed, total);
    }

    function test_claim_rejectsInvalidProofs() public {
        (uint256 dropId, uint256 potId, bytes32[][] memory l,) = _drop(10, 0);
        _resolve(potId, true);
        bytes32[] memory p = Tree.proof(l, 3);
        vm.expectRevert(MerkleBook.InvalidProof.selector); // wrong amount
        book.claim(dropId, 3, _account(3), _amount(3) + 1, p);
        vm.expectRevert(MerkleBook.InvalidProof.selector); // wrong account
        book.claim(dropId, 3, _account(4), _amount(3), p);
        vm.expectRevert(MerkleBook.InvalidProof.selector); // wrong index
        book.claim(dropId, 4, _account(3), _amount(3), p);
        p[0] = bytes32(uint256(p[0]) ^ 1);
        vm.expectRevert(MerkleBook.InvalidProof.selector); // tampered proof
        book.claim(dropId, 3, _account(3), _amount(3), p);
    }

    function test_claim_rejectsDoubleClaim() public {
        (uint256 dropId, uint256 potId, bytes32[][] memory l,) = _drop(10, 0);
        _resolve(potId, true);
        _claim(dropId, l, 2);
        vm.expectRevert(MerkleBook.AlreadyClaimed.selector);
        _claim(dropId, l, 2);
    }

    function test_claim_onlyAfterPositiveOutcome() public {
        (uint256 dropId, uint256 potId, bytes32[][] memory l, uint256 total) = _drop(10, 0);
        vm.expectRevert(MerkleBook.NotTriggered.selector); // still open
        _claim(dropId, l, 0);
        uint256 before = usdc.balanceOf(funder);
        _resolve(potId, false);
        assertEq(usdc.balanceOf(funder) - before, total); // the vault refunds the funder directly
        vm.expectRevert(MerkleBook.NotTriggered.selector);
        _claim(dropId, l, 0);
        assertEq(usdc.balanceOf(address(book)), 0);
    }

    function test_claim_capsAtPot_evenIfTreeOverAllocates() public {
        // Leaves sum to `total`, but the root declares and the pot holds only half of it.
        (bytes32[][] memory l, uint256 total) = _tree(10);
        uint256 half = total / 2;
        uint256 potId = _pot(half);
        vm.prank(funder);
        uint256 dropId = book.open(potId, _lock(), _claimDeadline(), Tree.root(l), half);
        _resolve(potId, true);
        uint256 paid;
        uint256 i;
        for (; paid + _amount(i) <= half; ++i) {
            _claim(dropId, l, i);
            paid += _amount(i);
        }
        vm.expectRevert(MerkleBook.OverAllocated.selector);
        _claim(dropId, l, i);
        assertEq(usdc.balanceOf(address(book)), half - paid);
    }

    function test_claim_blocklistedAccountIsDeferred() public {
        (uint256 dropId, uint256 potId, bytes32[][] memory l,) = _drop(3, 0);
        usdc.setBlocked(_account(1), true);
        _resolve(potId, true);
        for (uint256 i; i < 3; ++i) _claim(dropId, l, i);
        assertEq(usdc.balanceOf(_account(0)), _amount(0));
        assertEq(usdc.balanceOf(_account(2)), _amount(2));
        assertEq(book.claimable(_account(1)), _amount(1));
        usdc.setBlocked(_account(1), false);
        vm.prank(_account(1));
        book.withdrawDeferred();
        assertEq(usdc.balanceOf(_account(1)), _amount(1));
        assertEq(usdc.balanceOf(address(book)), 0);
    }

    function test_claim_pullsFromVaultIfBookWasBlocked() public {
        (uint256 dropId, uint256 potId, bytes32[][] memory l,) = _drop(3, 0);
        usdc.setBlocked(address(book), true);
        _resolve(potId, true); // payout to the book fails, so the vault holds it as claimable
        usdc.setBlocked(address(book), false);
        _claim(dropId, l, 0);
        assertEq(usdc.balanceOf(_account(0)), _amount(0));
        assertEq(vault.claimable(address(book)), 0);
    }

    // ------------------------------------------------------------------ window / sweep

    function test_claimWindowExpiry_thenSweepReturnsRest() public {
        (uint256 dropId, uint256 potId, bytes32[][] memory l, uint256 total) = _drop(10, 3e6);
        _resolve(potId, true);
        _claim(dropId, l, 0);
        _claim(dropId, l, 1);
        vm.expectRevert(MerkleBook.ClaimWindowOpen.selector);
        book.sweep(dropId);

        vm.warp(_claimDeadline() + 1);
        vm.expectRevert(MerkleBook.ClaimWindowClosed.selector);
        _claim(dropId, l, 2);

        uint256 before = usdc.balanceOf(funder);
        book.sweep(dropId); // anyone may call; money goes to the funder
        assertEq(usdc.balanceOf(funder) - before, total + 3e6 - _amount(0) - _amount(1));
        assertEq(usdc.balanceOf(address(book)), 0);
        vm.expectRevert(MerkleBook.AlreadySwept.selector);
        book.sweep(dropId);
    }

    // ------------------------------------------------------------------ fuzz

    /// Any subset of claims in any order: each account gets exactly its amount once, and claims
    /// plus sweep return exactly the pot.
    function testFuzz_claimsAndSweepConserve(uint8 nRaw, uint256 mask, uint96 extra) public {
        uint256 n = bound(nRaw, 1, 64);
        uint256 ex = bound(extra, 0, 100e6);
        (uint256 dropId, uint256 potId, bytes32[][] memory l, uint256 total) = _drop(n, ex);
        _resolve(potId, true);
        uint256 paid;
        for (uint256 i; i < n; ++i) {
            if ((mask >> i) & 1 == 1) {
                _claim(dropId, l, i);
                paid += _amount(i);
            }
        }
        vm.warp(_claimDeadline() + 1);
        uint256 before = usdc.balanceOf(funder);
        book.sweep(dropId);
        assertEq(usdc.balanceOf(funder) - before + paid, total + ex);
        assertEq(usdc.balanceOf(address(book)), 0);
    }

    // ------------------------------------------------------------------ gas report

    /// Per-payee gas for a pull (Merkle) claim, measured on trees of 10, 1,000 and 10,000 payees,
    /// next to the push model (GuaranteeBook.payout, which is capped at 50 customers per pot).
    function test_gasReport() public {
        uint256[3] memory sizes = [uint256(10), 1_000, 10_000];
        for (uint256 k; k < 3; ++k) {
            uint256 n = sizes[k];
            (uint256 dropId, uint256 potId, bytes32[][] memory l,) = _drop(n, 0);
            _resolve(potId, true);
            uint256 samples = n < 20 ? n : 20;
            uint256 sum;
            for (uint256 s; s < samples; ++s) {
                uint256 i = (s * n) / samples;
                bytes32[] memory p = Tree.proof(l, i);
                uint256 g = gasleft();
                book.claim(dropId, i, _account(i), _amount(i), p);
                sum += g - gasleft();
            }
            console.log("merkle claim, payees:", n);
            console.log("  proof length:", Tree.proof(l, 0).length, " avg gas/claim:", sum / samples);
        }

        // Push model: one payout tx paying every enrolled customer.
        GuaranteeBook gb = new GuaranteeBook(vault, operator);
        address[] memory pp = new address[](1);
        uint16[] memory ss = new uint16[](1);
        pp[0] = address(gb);
        ss[0] = 10_000;
        vm.startPrank(funder);
        uint256 pot = vault.createPot(COND, vm.addr(RESOLVER_PK), pp, ss, funder, deadline);
        vault.fund(pot, 50e6);
        vm.stopPrank();
        vm.prank(operator);
        uint256 gid = gb.open(pot, 1e6, 50, _lock());
        for (uint256 i; i < 50; ++i) {
            vm.prank(operator);
            gb.enrol(gid, _account(50_000 + i));
        }
        _resolve(pot, true);
        uint256 g0 = gasleft();
        gb.payout(gid, 50);
        uint256 used = g0 - gasleft();
        console.log("push payout, payees: 50  total gas:", used, " gas/payee:", used / 50);
    }
}
