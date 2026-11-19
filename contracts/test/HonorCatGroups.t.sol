// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatGroups} from "../src/HonorCatGroups.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Accepts exactly the signature "ok" (the resolver's own checks are tested in MedianResolver.t.sol).
contract OkResolver {
    function isValidSignature(bytes32, bytes calldata sig) external pure returns (bytes4) {
        return keccak256(sig) == keccak256("ok") ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract HonorCatGroupsTest is Test {
    HonorCatGroups groups;
    MockUSDC usdc;
    OkResolver resolver;
    uint256 gid;
    uint64 close;
    address[] people;

    uint8 constant YES = 0;
    uint8 constant NO = 1;

    function setUp() public {
        usdc = new MockUSDC();
        groups = new HonorCatGroups(IERC20(address(usdc)));
        resolver = new OkResolver();
        vm.warp(1_800_000_000);
        close = uint64(block.timestamp + 30 days);
        gid = _create(4_000_000); // cap: 4,000,000 hundredths x 0.0025 = $10,000 -> limited to $100
        for (uint256 i; i < 400; ++i) {
            address a = address(uint160(0x1000 + i));
            people.push(a);
            usdc.mint(a, 1_000_000_000);
            vm.prank(a);
            usdc.approve(address(groups), type(uint256).max);
        }
    }

    function _create(uint64 contracts5c) internal returns (uint256) {
        HonorCatGroups.DepthAttestation memory d = HonorCatGroups.DepthAttestation(keccak256("market"), address(this), contracts5c, 10_000, false, close, uint64(block.timestamp + 60));
        return groups.create(address(resolver), d, "ok", 3 days, 30, 10, "Texas fans", "Arkansas fans");
    }

    function _att(uint256 g, uint64 k, uint32 price, bool valid) internal view returns (HonorCatGroups.WindowAttestation memory a) {
        (uint64 ws, uint64 we) = groups.windowOf(g, k);
        a = HonorCatGroups.WindowAttestation(g, groups.KIND_BATCH(), k, ws, we, valid ? 15 : 0, valid ? price : 0, valid, bytes32(0));
    }

    /// @dev Clears the group's next batch at `price` (warping to its window's end).
    function _clearNext(uint32 price) internal returns (uint64 k) {
        k = groups.group(gid).nextBatch;
        (, uint64 we) = groups.windowOf(gid, k);
        if (block.timestamp < we) vm.warp(we);
        groups.clear(gid, _att(gid, k, price, true), "ok");
    }

    function _nextBatchStart() internal {
        uint64 k = groups.batchOf(gid, block.timestamp);
        (uint64 ws,) = groups.windowOf(gid, k);
        vm.warp(ws); // the start of batch k + 1
    }

    function _join(address a, uint8 t, uint256 amt, bool wait) internal {
        vm.prank(a);
        groups.join(gid, t, amt, wait);
    }

    function _notional(address a) internal view returns (uint256 n) {
        (,, n,) = groups.positionOf(gid, a);
    }

    function _withdraw(address a) internal returns (uint256 got) {
        uint256 before = usdc.balanceOf(a);
        vm.prank(a);
        try groups.withdraw(gid) {} catch {}
        got = usdc.balanceOf(a) - before;
    }

    function _settle(uint8 outcome) internal {
        vm.warp(close + 1);
        groups.settle(gid, HonorCatGroups.OutcomeAttestation(gid, keccak256("market"), outcome, bytes32(0)), "ok");
    }

    // ---------------------------------------------------------------- basics

    function test_matchAtThePriceAndSettle() public {
        address alice = people[0];
        address bob = people[1];
        _join(alice, YES, 6_000_000, false); // $6 on YES
        _join(bob, NO, 4_000_000, false); // $4 on NO
        _clearNext(600_000); // 60%: both teams get $10 of notional
        groups.claim(gid, alice);
        groups.claim(gid, bob);
        assertEq(_notional(alice), 10_000_000);
        assertEq(_notional(bob), 10_000_000);
        assertEq(groups.team(gid, YES).pool, groups.team(gid, NO).pool);
        _settle(1);
        assertEq(_withdraw(alice), 10_000_000);
        assertEq(_withdraw(bob), 0);
    }

    function test_largerSideFilledProRataRestBackOrWaits() public {
        address a = people[0];
        address b = people[1];
        address c = people[2];
        _join(a, YES, 6_000_000, false); // refunds its rest
        _join(b, YES, 6_000_000, true); // its rest waits
        _join(c, NO, 4_000_000, false);
        _clearNext(600_000); // NO covers $10 of notional: YES fills $6 of its $12 (half each)
        groups.claim(gid, a);
        groups.claim(gid, b);
        assertEq(_notional(a), 5_000_000);
        assertEq(_notional(b), 5_000_000);
        assertEq(groups.claimable(gid, a), 3_000_000);
        assertEq(groups.claimable(gid, b), 0);
        (,,, bool active,,,,) = groups.requests(gid, b);
        assertTrue(active); // waiting
        // the next batch: a new NO joiner meets b's waiting $3
        _nextBatchStart();
        _join(people[3], NO, 2_000_000, false);
        _clearNext(600_000); // the batch the rest waited in (nobody on NO yet)
        _clearNext(600_000); // the batch with the new NO joiner
        groups.claim(gid, b);
        assertEq(_notional(b), 10_000_000); // 5 + 3/0.6
        (,,, active,,,,) = groups.requests(gid, b);
        assertFalse(active);
    }

    function test_leaveIsTakenOverByWaitingJoinsOfTheSameTeam() public {
        address alice = people[0];
        address bob = people[1];
        address carol = people[2];
        _join(alice, YES, 6_000_000, false);
        _join(bob, NO, 4_000_000, false);
        _clearNext(600_000);
        _nextBatchStart();
        vm.prank(alice);
        groups.leave(gid, 10_000_000);
        _join(carol, YES, 7_000_000, true); // more than enough to take Alice's place at 70%
        _clearNext(700_000);
        groups.claim(gid, alice);
        groups.claim(gid, carol);
        groups.claim(gid, bob);
        assertEq(groups.claimable(gid, alice), 7_000_000 - 70_000); // $7 less the 1% fee
        assertEq(_notional(carol), 10_000_000);
        assertEq(_notional(bob), 10_000_000); // Bob did not shrink
        assertEq(groups.claimable(gid, bob), 70_000); // the fee went to the other team
    }

    function test_leaveWithNoTakersShrinksTheOtherTeamProRata() public {
        address alice = people[0];
        address bob = people[1];
        address dan = people[2];
        _join(alice, YES, 6_000_000, false);
        _join(bob, NO, 2_000_000, false);
        _join(dan, NO, 2_000_000, false);
        _clearNext(600_000);
        _nextBatchStart();
        vm.prank(alice);
        groups.leave(gid, 4_000_000); // 4 of 10
        _clearNext(500_000);
        groups.claim(gid, alice);
        groups.claim(gid, bob);
        groups.claim(gid, dan);
        assertEq(groups.claimable(gid, alice), 2_000_000 - 20_000);
        assertEq(_notional(alice), 6_000_000);
        // Bob and Dan each shrink by 2 and get 2 x 0.5 = 1, plus half the fee
        assertApproxEqAbs(_notional(bob), 3_000_000, 2);
        assertApproxEqAbs(groups.claimable(gid, bob), 1_000_000 + 10_000, 2);
        assertApproxEqAbs(_notional(dan), 3_000_000, 2);
        assertEq(groups.team(gid, YES).pool, groups.team(gid, NO).pool);
    }

    function test_failedBatchReturnsLeavesAndRefunds() public {
        address alice = people[0];
        address bob = people[1];
        _join(alice, YES, 6_000_000, false);
        _join(bob, NO, 4_000_000, false);
        _clearNext(600_000);
        _nextBatchStart();
        vm.prank(alice);
        groups.leave(gid, 5_000_000);
        _join(people[2], NO, 3_000_000, false);
        uint64 k = groups.group(gid).nextBatch;
        (, uint64 we) = groups.windowOf(gid, k);
        vm.warp(we + 601);
        groups.failBatch(gid);
        groups.claim(gid, alice);
        groups.claim(gid, people[2]);
        assertEq(_notional(alice), 10_000_000); // back in full
        assertEq(groups.claimable(gid, people[2]), 3_000_000); // refunded
    }

    function test_voidGivesEachTeamItsRemainingDepositsProRata() public {
        _join(people[0], YES, 6_000_000, false);
        _join(people[1], YES, 3_000_000, false);
        _join(people[2], NO, 6_000_000, false);
        _clearNext(600_000); // YES $9 -> 15 notional, NO $6 -> 15 notional
        _settle(2);
        assertApproxEqAbs(_withdraw(people[0]), 6_000_000, 2);
        assertApproxEqAbs(_withdraw(people[1]), 3_000_000, 2);
        assertApproxEqAbs(_withdraw(people[2]), 6_000_000, 2);
    }

    function test_transferPosition() public {
        _join(people[0], YES, 6_000_000, false);
        _join(people[1], NO, 4_000_000, false);
        _clearNext(600_000);
        groups.claim(gid, people[0]);
        vm.prank(people[0]);
        groups.transferPosition(gid, people[5]);
        assertEq(_notional(people[5]), 10_000_000);
        assertEq(_notional(people[0]), 0);
        _settle(1);
        assertEq(_withdraw(people[5]), 10_000_000);
    }

    // ---------------------------------------------------------------- attestations

    function test_clearingNeedsAValidAttestationInOrderAndOnTime() public {
        _join(people[0], YES, 6_000_000, false);
        _join(people[1], NO, 4_000_000, false);
        uint64 k = groups.group(gid).nextBatch;
        HonorCatGroups.WindowAttestation memory a = _att(gid, k, 600_000, true);
        vm.expectRevert(HonorCatGroups.TooEarly.selector);
        groups.clear(gid, a, "ok");
        (, uint64 we) = groups.windowOf(gid, k);
        vm.warp(we);
        vm.expectRevert(HonorCatGroups.InvalidAttestation.selector);
        groups.clear(gid, a, "bad");
        HonorCatGroups.WindowAttestation memory w = _att(gid, k, 600_000, true);
        w.windowStart -= 1;
        vm.expectRevert(HonorCatGroups.InvalidAttestation.selector);
        groups.clear(gid, w, "ok");
        w = _att(gid, k, 600_000, true);
        w.kind = 1;
        vm.expectRevert(HonorCatGroups.InvalidAttestation.selector);
        groups.clear(gid, w, "ok");
        w = _att(gid, k, 600_000, true);
        w.nonce = k + 1;
        vm.expectRevert(HonorCatGroups.WrongState.selector);
        groups.clear(gid, w, "ok");
        w = _att(gid, k, 600_000, true);
        w.sampleCount = 3; // fewer than the minimum
        vm.expectRevert(HonorCatGroups.InvalidAttestation.selector);
        groups.clear(gid, w, "ok");
        groups.clear(gid, a, "ok");
        vm.expectRevert(HonorCatGroups.WrongState.selector);
        groups.clear(gid, a, "ok"); // never twice
    }

    // ---------------------------------------------------------------- precision

    function test_precisionOverManyShrinksAndAScaleChange() public {
        address big = people[0];
        _join(big, YES, 50_000_000, false);
        _join(people[1], NO, 25_000_000, false);
        _join(people[2], NO, 25_000_000, false);
        _clearNext(500_000); // 100 notional per team
        // each round: the YES side leaves 90% (NO shrinks to a tenth), then both teams are refilled
        for (uint256 i; i < 11; ++i) {
            _nextBatchStart();
            groups.claim(gid, big);
            uint256 n = _notional(big);
            vm.prank(big);
            groups.leave(gid, (n * 9) / 10);
            _clearNext(500_000);
            groups.claim(gid, big);
            _nextBatchStart();
            _join(big, YES, 45_000_000, false);
            _join(people[3 + i], NO, 45_000_000, false);
            _clearNext(500_000);
        }
        assertGt(groups.team(gid, NO).scale, 0, "a scale change happened");
        // every NO member's notional adds up to the pool (within rounding), and never more
        uint256 sum;
        for (uint256 i = 1; i < 14; ++i) {
            groups.claim(gid, people[i]);
            sum += _notional(people[i]);
        }
        uint256 pool = groups.team(gid, NO).pool;
        assertLe(sum, pool);
        assertApproxEqAbs(sum, pool, 100);
        // the last refill holds most of it: 90 notional, then shrunk by nothing since
        assertApproxEqAbs(_notional(people[13]), 90_000_000, 100);
    }

    function test_epochResetWhenATeamIsEmptied() public {
        _join(people[0], YES, 5_000_000, false);
        _join(people[1], NO, 5_000_000, false);
        _clearNext(500_000);
        _nextBatchStart();
        groups.claim(gid, people[0]);
        uint256 all = _notional(people[0]);
        vm.prank(people[0]);
        groups.leave(gid, all); // all of YES leaves: NO is emptied
        _clearNext(500_000);
        assertEq(groups.team(gid, NO).epoch, 1);
        groups.claim(gid, people[1]);
        assertEq(_notional(people[1]), 0);
        assertApproxEqAbs(groups.claimable(gid, people[1]), 5_000_000 + 50_000, 2); // value + YES's fee
        // a new round works on the fresh epoch
        _nextBatchStart();
        _join(people[2], YES, 3_000_000, false);
        _join(people[3], NO, 7_000_000, false);
        _clearNext(300_000);
        groups.claim(gid, people[3]);
        assertEq(_notional(people[3]), 10_000_000);
    }

    // ---------------------------------------------------------------- gas stays flat as members grow

    function test_gasDoesNotGrowWithMembers() public {
        // 2 members
        _join(people[0], YES, 1_000_000, false);
        _join(people[1], NO, 1_000_000, false);
        _clearNext(500_000);
        _nextBatchStart();
        vm.prank(people[0]);
        groups.leave(gid, 500_000);
        uint64 k = groups.group(gid).nextBatch;
        (, uint64 we) = groups.windowOf(gid, k);
        vm.warp(we);
        HonorCatGroups.WindowAttestation memory a = _att(gid, k, 500_000, true);
        uint256 g0 = gasleft();
        groups.clear(gid, a, "ok");
        uint256 small = g0 - gasleft();
        // 300 more members
        _nextBatchStart();
        for (uint256 i = 2; i < 302; ++i) _join(people[i], i % 2 == 0 ? YES : NO, 100_000, false);
        _clearNext(500_000);
        _nextBatchStart();
        vm.prank(people[0]);
        groups.leave(gid, 100_000);
        k = groups.group(gid).nextBatch;
        (, we) = groups.windowOf(gid, k);
        vm.warp(we);
        a = _att(gid, k, 500_000, true);
        g0 = gasleft();
        groups.clear(gid, a, "ok");
        uint256 large = g0 - gasleft();
        assertLt(large, small + 30_000); // the same work, whatever the number of members
        // a member's claim does not depend on the number of members either
        g0 = gasleft();
        groups.claim(gid, people[301]);
        assertLt(g0 - gasleft(), 200_000);
    }

    // ---------------------------------------------------------------- funds add up (fuzz)

    /// @dev Random joins, leaves and prices over several batches, then a result: the teams stay equal,
    ///      no member is paid more than their position is worth, and the contract never owes more
    ///      than it holds (every withdrawal succeeds; what is left is dust).
    function testFuzz_fundsAddUp(uint256 seed, uint8 outcomeSeed) public {
        uint256 n = 24;
        uint256 deposited;
        for (uint256 round; round < 8; ++round) {
            for (uint256 i; i < n; ++i) {
                uint256 r = uint256(keccak256(abi.encode(seed, round, i)));
                address a = people[i];
                uint8 t = uint8(i % 2);
                if (r % 3 == 0) {
                    (bool active,,,) = groups.positionOf(gid, a);
                    (,,, bool req,,,,) = groups.requests(gid, a);
                    (bool ex,,) = groups.exits(gid, a);
                    if (!req) {
                        uint256 amt = 100_000 + (r >> 8) % 3_000_000;
                        vm.prank(a);
                        try groups.join(gid, t, amt, (r >> 4) % 2 == 0) {
                            deposited += amt;
                        } catch {}
                    } else if (active && !ex) {
                        groups.claim(gid, a);
                        uint256 cur = _notional(a);
                        if (cur > 1) {
                            vm.prank(a);
                            try groups.leave(gid, 1 + (r >> 16) % cur) {} catch {}
                        }
                    }
                }
            }
            uint32 price = uint32(50_000 + uint256(keccak256(abi.encode(seed, "p", round))) % 900_000);
            uint64 k = groups.group(gid).nextBatch;
            if (k != type(uint64).max) _clearNext(price);
            // carried joins may need more batches
            for (uint256 j; j < 3; ++j) {
                k = groups.group(gid).nextBatch;
                if (k == type(uint64).max) break;
                _clearNext(price);
            }
            HonorCatGroups.Team memory y = groups.team(gid, YES);
            HonorCatGroups.Team memory no = groups.team(gid, NO);
            assertEq(y.pool + y.exiting, no.pool + no.exiting, "teams equal");
            _nextBatchStart();
        }
        uint8 outcome = outcomeSeed % 3;
        _settle(outcome);
        uint256 out;
        for (uint256 i; i < n; ++i) {
            address a = people[i];
            groups.claim(gid, a);
            (bool active, uint8 t, uint256 cur,) = groups.positionOf(gid, a);
            uint256 before = groups.claimable(gid, a);
            uint256 got = _withdraw(a);
            out += got;
            if (active && outcome < 2) {
                bool won = (outcome == 1 && t == YES) || (outcome == 0 && t == NO);
                assertLe(got, before + (won ? cur : 0), "no more than the position is worth");
            }
        }
        assertLe(out, deposited, "never more out than in");
        assertEq(usdc.balanceOf(address(groups)), deposited - out, "the rest stays (dust)");
        assertLe(deposited - out, 1_000, "only rounding dust is left (every withdrawal went through)");
    }
}
