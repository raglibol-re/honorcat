// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatRopes} from "../../../src/HonorCatRopes.sol";
import {HonorCatRopesExtension} from "../../../src/ropes/HonorCatRopesExtension.sol";
import {HonorCatRopesExtra} from "../../../src/ropes/HonorCatRopesExtra.sol";
import {RopesBase} from "../../../src/ropes/RopesBase.sol";
import {HonorCatPerps} from "../../../src/HonorCatPerps.sol";
import {MultisigResolver} from "../../../src/resolvers/MultisigResolver.sol";
import {MockUSDC} from "../../mocks/MockUSDC.sol";

/// @notice Drives random sequences of perp actions across several perps with real signatures.
contract PerpsHandler is Test {
    HonorCatRopes public ropes;
    HonorCatRopesExtension ext;
    HonorCatRopesExtra xr;
    HonorCatPerps public perps;
    MockUSDC public usdc;
    MultisigResolver res;
    uint256[] sorted;
    address[4] public actors;
    uint256[] public ids;
    bytes32 constant COND = keccak256("PERP-INV");
    uint64 public close;
    mapping(uint256 => bool) public endedSeen;
    uint256 public maxRopes;
    uint256 public ended;

    constructor(HonorCatRopes r, HonorCatPerps p, MockUSDC u, MultisigResolver res_, uint256[] memory sorted_) {
        ropes = r;
        ext = HonorCatRopesExtension(address(r));
        xr = HonorCatRopesExtra(address(r));
        perps = p;
        usdc = u;
        res = res_;
        sorted = sorted_;
        close = uint64(block.timestamp + 5 days);
        for (uint256 i; i < 4; ++i) {
            actors[i] = address(uint160(0xC000 + i));
            usdc.mint(actors[i], 1_000e6);
            vm.prank(actors[i]);
            usdc.approve(address(perps), type(uint256).max);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _sign2(bytes32 d) internal view returns (bytes memory) {
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(sorted[0], d);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(sorted[1], d);
        return bytes.concat(abi.encodePacked(r1, s1, v1), abi.encodePacked(r2, s2, v2));
    }

    function _depth() internal view returns (RopesBase.DepthAttestation memory d, bytes memory sigs) {
        d = RopesBase.DepthAttestation(COND, address(perps), 100_000_000, 10_000, true, close, uint64(block.timestamp + 60));
        sigs = _sign2(ropes.depthDigest(d));
    }

    function _att(uint256 pot, uint8 kind, uint64 nonce, uint64 start, uint32 window, uint32 price, bool valid) internal pure returns (RopesBase.WindowAttestation memory) {
        return RopesBase.WindowAttestation(pot, kind, nonce, start, start + window, valid ? 30 : 0, price, valid, keccak256(abi.encode(pot, kind, nonce, start)));
    }

    function _pick(uint256 seed, HonorCatPerps.Phase phase) internal view returns (uint256) {
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[(seed + i) % ids.length];
            if (perps.perp(id).phase == phase) return id;
        }
        return 0;
    }

    function _record() internal {
        for (uint256 i; i < ids.length; ++i) if (perps.perp(ids[i]).phase == HonorCatPerps.Phase.Ended) endedSeen[ids[i]] = true;
    }

    // ---------------------------------------------------------------- actions

    function open(uint256 who, uint8 side, uint256 lives, uint256 dSeed) external {
        uint32 d = uint32(((bound(dSeed, 50_000, 150_000)) / 100) * 100);
        HonorCatPerps.Terms memory t = HonorCatPerps.Terms(COND, address(res), side % 2, d, 50, 2 hours, close, 1 days, 30, 10, 20_000);
        uint256 s = (uint256(d) / 100) * 50;
        vm.prank(actors[who % 4]);
        try perps.open(t, bound(lives, 1, 5) * s) returns (uint256 id) {
            ids.push(id);
        } catch {}
    }

    function join(uint256 seed, uint256 who, uint256 lives) external {
        uint256 id = _pick(seed, HonorCatPerps.Phase.Open);
        if (id == 0) return;
        uint256 s = perps.stake(id);
        vm.prank(actors[who % 4]);
        try perps.join(id, bound(lives, 1, 5) * s + s / 400) {} catch {}
    }

    function start(uint256 seed) external {
        uint256 id = _pick(seed, HonorCatPerps.Phase.Funded);
        if (id == 0) return;
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth();
        try perps.startFirstRope(id, 500_000, d, sigs) {} catch {}
    }

    function priceJoin(uint256 seed, uint32 price) external {
        uint256 id = _pick(seed, HonorCatPerps.Phase.Joining);
        if (id == 0) return;
        uint256 pot = perps.perp(id).pot;
        RopesBase.Pot memory p = ropes.pot(pot);
        RopesBase.WindowAttestation memory a = _att(pot, 0, p.nonce, p.requestTime + 1, p.window, uint32(bound(price, 460_000, 540_000)), true);
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        try ropes.resolveJoin(a, _sign2(ropes.windowDigest(a))) {} catch {}
    }

    function knock(uint256 seed, bool upper, uint32 beyond) external {
        uint256 id = _pick(seed, HonorCatPerps.Phase.Running);
        if (id == 0) return;
        uint256 pot = perps.perp(id).pot;
        RopesBase.Pot memory p = ropes.pot(pot);
        if (p.state != RopesBase.State.Live) return;
        uint32 trig = upper ? p.upper : p.lower;
        RopesBase.WindowAttestation memory a = _att(pot, 7, p.nonce, uint64(block.timestamp + 1), p.window, trig, true);
        vm.warp(a.windowEnd);
        try ropes.triggerKnockOut(a, _sign2(ropes.windowDigest(a))) {} catch {
            return;
        }
        p = ropes.pot(pot);
        // three in four land within 5 points past the post; one in four is a jump anywhere beyond it
        bool far = beyond % 4 == 0;
        uint32 px = upper
            ? uint32(bound(beyond, p.upper, far ? 1_000_000 : p.upper + 50_000))
            : uint32(bound(beyond, far ? 0 : (p.lower > 50_000 ? p.lower - 50_000 : 0), p.lower));
        RopesBase.WindowAttestation memory b = _att(pot, 1, p.nonce, p.requestTime + 1, p.window, px, true);
        vm.warp(b.windowEnd);
        try ropes.resolveExit(b, _sign2(ropes.windowDigest(b))) {} catch {}
    }

    function expiry(uint256 seed, uint32 price) external {
        uint256 id = _pick(seed, HonorCatPerps.Phase.Running);
        if (id == 0) return;
        uint256 pot = perps.perp(id).pot;
        RopesBase.Pot memory p = ropes.pot(pot);
        if (p.state != RopesBase.State.Live) return;
        RopesBase.WindowAttestation memory a = _att(pot, 8, p.nonce, xr.expiryWindowStart(pot, p.expiryTry), p.window, uint32(bound(price, 0, 1_000_000)), true);
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        try ext.resolveExpiry(a, _sign2(ropes.windowDigest(a))) {} catch {}
    }

    function leave(uint256 seed, bool creator, uint32 price) external {
        uint256 id = _pick(seed, HonorCatPerps.Phase.Running);
        if (id == 0) return;
        HonorCatPerps.Perp memory q = perps.perp(id);
        vm.prank(creator ? q.a : q.b);
        try perps.leaveNow(id) {} catch {
            return;
        }
        RopesBase.Pot memory p = ropes.pot(q.pot);
        RopesBase.WindowAttestation memory a = _att(q.pot, 1, p.nonce, p.requestTime + 1, p.window, uint32(bound(price, 0, 1_000_000)), true);
        vm.warp(a.windowEnd);
        try ropes.resolveExit(a, _sign2(ropes.windowDigest(a))) {} catch {}
    }

    function advance(uint256 seed) external {
        if (ids.length == 0) return;
        // prefer a perp with something to do: a priced or failed first join, or a rope that ended
        uint256 id = ids[seed % ids.length];
        for (uint256 i; i < ids.length; ++i) {
            uint256 c = ids[(seed + i) % ids.length];
            HonorCatPerps.Perp memory q = perps.perp(c);
            if (q.pot == 0) continue;
            RopesBase.State st = ropes.pot(q.pot).state;
            bool joinDone = q.phase == HonorCatPerps.Phase.Joining && (st == RopesBase.State.Live || st == RopesBase.State.Open);
            bool ropeDone = q.phase == HonorCatPerps.Phase.Running && uint8(st) >= uint8(RopesBase.State.Divided);
            if (joinDone || ropeDone) {
                id = c;
                break;
            }
        }
        (RopesBase.DepthAttestation memory d, bytes memory sigs) = _depth();
        try perps.advance(id, d, sigs) {} catch {}
        if (perps.perp(id).ropes > maxRopes) maxRopes = perps.perp(id).ropes;
        if (perps.perp(id).phase == HonorCatPerps.Phase.Ended && !endedSeen[id]) ended++;
        _record();
    }

    function stopRenewing(uint256 seed, bool creator) external {
        if (ids.length == 0) return;
        HonorCatPerps.Perp memory q = perps.perp(ids[seed % ids.length]);
        vm.prank(creator ? q.a : q.b);
        try perps.stopRenewing(ids[seed % ids.length]) {} catch {}
    }

    function addLives(uint256 seed, bool creator, uint256 amount) external {
        if (ids.length == 0) return;
        HonorCatPerps.Perp memory q = perps.perp(ids[seed % ids.length]);
        vm.prank(creator ? q.a : q.b);
        try perps.addLives(ids[seed % ids.length], bound(amount, 1, 1e6)) {} catch {}
    }

    function withdraw(uint256 seed, bool creator, uint256 amount) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        HonorCatPerps.Perp memory q = perps.perp(id);
        uint256 free = creator ? q.freeA : q.freeB;
        if (free == 0) return;
        vm.prank(creator ? q.a : q.b);
        try perps.withdraw(id, bound(amount, 1, free)) {} catch {}
        _record();
    }
}

/// forge-config: default.invariant.runs = 48
/// forge-config: default.invariant.depth = 200
contract PerpsInvariants is Test {
    PerpsHandler h;
    MockUSDC usdc;
    HonorCatPerps perps;
    HonorCatRopes ropes;
    uint256 total0;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        uint256[3] memory pks = [uint256(0xD1), uint256(0xD2), uint256(0xD3)];
        address[] memory owners = new address[](3);
        for (uint256 i; i < 3; ++i) owners[i] = vm.addr(pks[i]);
        MultisigResolver res = new MultisigResolver(owners, 2);
        uint256[] memory sorted = new uint256[](3);
        for (uint256 i; i < 3; ++i) sorted[i] = pks[i];
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (vm.addr(sorted[j]) < vm.addr(sorted[i])) (sorted[i], sorted[j]) = (sorted[j], sorted[i]);
            }
        }
        HonorCatRopesExtension impl = new HonorCatRopesExtension(IERC20(address(usdc)), address(new HonorCatRopesExtra(IERC20(address(usdc)))));
        ropes = new HonorCatRopes(IERC20(address(usdc)), address(this), address(impl));
        perps = new HonorCatPerps(ropes);
        h = new PerpsHandler(ropes, perps, usdc, res, sorted);
        for (uint256 i; i < 4; ++i) total0 += usdc.balanceOf(h.actors(i));
        targetContract(address(h));
    }

    function _total() internal view returns (uint256 t) {
        for (uint256 i; i < 4; ++i) t += usdc.balanceOf(h.actors(i));
        t += usdc.balanceOf(address(perps)) + usdc.balanceOf(address(ropes));
    }

    function afterInvariant() external view {
        console.log("perps", h.idsLength(), "most ropes in one chain", h.maxRopes());
        console.log("chains ended", h.ended());
    }

    /// The handler's own path reaches rolls and ends (so the random runs can too).
    function test_handlerPathRolls() public {
        h.open(0, 0, 3, 100_000);
        h.join(0, 1, 3);
        h.start(0);
        h.priceJoin(0, 500_000);
        h.advance(0);
        console.log("phase after first rope", uint8(perps.perp(1).phase), "ropes", perps.perp(1).ropes);
        h.knock(0, true, 1); // just past the upper post
        console.log("pot state after knock", uint8(ropes.pot(perps.perp(1).pot).state));
        h.advance(0);
        console.log("ropes after roll", perps.perp(1).ropes, "phase", uint8(perps.perp(1).phase));
        assertEq(perps.perp(1).ropes, 2);
    }

    /// Nothing is created or destroyed.
    function invariant_conservation() public view {
        assertEq(_total(), total0);
    }

    /// The perp contract holds exactly the players' free balances, plus payouts of ropes that ended
    /// and were not yet credited (credited at the next advance).
    function invariant_perpsHoldFreeBalances() public view {
        uint256 free;
        uint256 pending;
        for (uint256 i; i < h.idsLength(); ++i) {
            HonorCatPerps.Perp memory q = perps.perp(h.ids(i));
            free += q.freeA + q.freeB;
            if (q.pot != 0) {
                RopesBase.Pot memory p = ropes.pot(q.pot);
                if (p.state == RopesBase.State.Divided || p.state == RopesBase.State.Settled || p.state == RopesBase.State.Expired) {
                    (,,, uint128 py, uint128 pn) = ropes.divisions(q.pot);
                    pending += uint256(py) + pn;
                }
                if (q.phase == HonorCatPerps.Phase.Joining && p.state == RopesBase.State.Open) pending += p.escrowYes + p.escrowNo + 0; // join refund came back
                if (q.phase == HonorCatPerps.Phase.Joining && p.state == RopesBase.State.Live) pending += q.treat;
            }
        }
        // a failed join's refund is already here; the creator's escrow is still in the pot (counted there)
        assertGe(usdc.balanceOf(address(perps)), free);
        assertLe(usdc.balanceOf(address(perps)), free + pending + _joinRefunds());
    }

    function _joinRefunds() internal view returns (uint256 r) {
        for (uint256 i; i < h.idsLength(); ++i) {
            HonorCatPerps.Perp memory q = perps.perp(h.ids(i));
            if (q.phase == HonorCatPerps.Phase.Joining && q.pot != 0 && ropes.pot(q.pot).state == RopesBase.State.Open) r += perps.stake(h.ids(i)) + q.treat;
        }
    }

    /// One player's result is the other's loss: fees and treats move between them, never out.
    function invariant_resultsCancel() public view {
        for (uint256 i; i < h.idsLength(); ++i) {
            HonorCatPerps.Perp memory q = perps.perp(h.ids(i));
            assertEq(q.resultA + q.resultB, 0);
        }
    }

    /// An ended perp stays ended and holds nothing in a rope.
    function invariant_endedIsFinal() public view {
        for (uint256 i; i < h.idsLength(); ++i) {
            uint256 id = h.ids(i);
            if (h.endedSeen(id)) {
                assertEq(uint8(perps.perp(id).phase), uint8(HonorCatPerps.Phase.Ended));
                assertEq(perps.perp(id).pot, 0);
            }
        }
    }
}
