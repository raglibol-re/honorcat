// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatRopes} from "../../../src/HonorCatRopes.sol";
import {HonorCatRopesExtension} from "../../../src/ropes/HonorCatRopesExtension.sol";
import {RopesBase} from "../../../src/ropes/RopesBase.sol";
import {MultisigResolver} from "../../../src/resolvers/MultisigResolver.sol";
import {MockUSDC} from "../../mocks/MockUSDC.sol";

/// @notice Drives random sequences of every v2 action (normal pots and ropes, joins, exits, knock-outs,
///         extra lives, expiries, takeovers, settlement, deadline expiry, referrals, copies, transfers)
///         with properly signed attestations.
contract RopesHandler is Test {
    HonorCatRopes public ropes;
    HonorCatRopesExtension public ext;
    MockUSDC public usdc;
    MultisigResolver internal _res;
    uint256[] internal sorted;
    address[4] public actors;
    uint256[] public ids;
    bytes32 constant COND = keccak256("GEMI-INV-ROPE|rule");
    uint256 constant P = 1_000_000;
    mapping(uint256 => uint8) public terminalSeen;
    mapping(uint256 => uint64) public closeOf;
    mapping(string => uint256) public done;

    constructor(HonorCatRopes ropes_, MockUSDC usdc_, uint256[] memory sorted_, MultisigResolver res_) {
        ropes = ropes_;
        ext = HonorCatRopesExtension(address(ropes_));
        usdc = usdc_;
        sorted = sorted_;
        _res = res_;
        for (uint256 i; i < 4; ++i) {
            actors[i] = address(uint160(0xB000 + i));
            usdc.mint(actors[i], 10_000e6);
            vm.prank(actors[i]);
            usdc.approve(address(ropes), type(uint256).max);
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

    function _noAuth() internal pure returns (RopesBase.Authorization memory a) {}

    function _pick(uint256 seed, uint256 mask) internal view returns (uint256) {
        uint256 n = ids.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = ids[(seed + i) % n];
            if (mask & (1 << uint8(ropes.pot(id).state)) != 0) return id;
        }
        return 0;
    }

    function _record(uint256 id) internal {
        RopesBase.State s = ropes.pot(id).state;
        if (uint8(s) >= uint8(RopesBase.State.Divided) && terminalSeen[id] == 0) terminalSeen[id] = uint8(s);
    }

    function _recordAll() internal {
        for (uint256 i; i < ids.length; ++i) _record(ids[i]);
    }

    function _att(uint256 id, uint8 kind, uint64 nonce, uint64 start, uint32 window, uint32 price, bool valid)
        internal
        pure
        returns (RopesBase.WindowAttestation memory a)
    {
        a = RopesBase.WindowAttestation(id, kind, nonce, start, start + window, valid ? 30 : 0, price, valid, keccak256(abi.encode(id, kind, nonce, start)));
    }

    // ---------------------------------------------------------------- actions

    function create(uint256 actorSeed, uint8 side, uint256 size, uint32 center, uint32 tol, bool rope, uint32 dist, uint256 copySeed) external {
        uint64 close = uint64(block.timestamp + 3 days);
        address who = actors[actorSeed % 4];
        side = side % 2;
        size = bound(size, 1, 2_000);
        center = uint32(bound(center, 200_000, 800_000));
        tol = uint32(bound(tol, 0, 20_000));
        RopesBase.CreateParams memory c = RopesBase.CreateParams(COND, address(_res), side, size, center, tol, 0, 0, 0, close, 1 days, 20, 5, 0);
        if (rope) {
            dist = uint32((bound(dist, 50_000, 150_000) / 100) * 100);
            if (side == 0) c.distYes = dist;
            else c.distNo = dist;
            c.expiry = uint64(block.timestamp + 1 hours + (copySeed % 2 days));
        }
        if (copySeed % 3 == 0 && ids.length > 0) {
            uint256 lead = ids[copySeed % ids.length];
            if (ropes.ownerOf(lead * 2) != who) c.copyOf = lead * 2;
        }
        RopesBase.DepthAttestation memory d = RopesBase.DepthAttestation(COND, who, 100_000_000, 10_000, true, close, uint64(block.timestamp + 60));
        bytes memory sigs = _sign2(ropes.depthDigest(d));
        vm.prank(who);
        try ropes.create(c, d, sigs, _noAuth()) returns (uint256 id) {
            ids.push(id);
            closeOf[id] = close;
            done["create"]++;
        } catch {}
    }

    function requestJoin(uint256 seed, uint256 actorSeed, uint256 copySeed) external {
        uint256 id = _pick(seed, 1 << uint8(RopesBase.State.Open));
        if (id == 0) return;
        address who = actors[actorSeed % 4];
        uint256 copyOf;
        if (copySeed % 3 == 0) {
            uint256 lead = ids[copySeed % ids.length];
            if (lead != id && ropes.ownerOf(lead * 2) != who) copyOf = lead * 2;
        }
        vm.prank(who);
        try ropes.requestJoin(id, copyOf, _noAuth()) {
            done["requestJoin"]++;
        } catch {}
    }

    function resolveJoin(uint256 seed, uint32 price, bool valid) external {
        uint256 id = _pick(seed, 1 << uint8(RopesBase.State.Joining));
        if (id == 0) return;
        RopesBase.Pot memory p = ropes.pot(id);
        // mostly inside the creator's band (a real join), sometimes outside or invalid (a refund)
        uint32 px = price % 5 == 0
            ? uint32(bound(price, 150_000, 850_000))
            : uint32(bound(price, p.bandCenter - p.tolerance, p.bandCenter + p.tolerance));
        RopesBase.WindowAttestation memory a = _att(id, 0, p.nonce, p.requestTime + 1, p.window, px, valid || price % 4 != 0);
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        try ropes.resolveJoin(a, _sign2(ropes.windowDigest(a))) {
            done["resolveJoin"]++;
        } catch {}
    }

    function requestExit(uint256 seed, uint8 side, uint256 n) external {
        uint256 id = _pick(seed, 1 << uint8(RopesBase.State.Live));
        if (id == 0) return;
        side = side % 2;
        RopesBase.Pot memory p = ropes.pot(id);
        n = n % 3 == 0 ? p.size : bound(n, 1, p.size); // a third are full exits (takeovers possible)
        address owner = ropes.ownerOf(id * 2 + side);
        vm.prank(owner);
        try ext.requestExit(id, side, n) {
            done["requestExit"]++;
        } catch {}
    }

    function resolveExit(uint256 seed, uint32 price, bool valid) external {
        uint256 id = _pick(seed, 1 << uint8(RopesBase.State.ExitRequested));
        if (id == 0) return;
        RopesBase.Pot memory p = ropes.pot(id);
        RopesBase.WindowAttestation memory a = _att(id, 1, p.nonce, p.requestTime + 1, p.window, uint32(bound(price, 0, P)), valid || price % 4 != 0);
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        try ropes.resolveExit(a, _sign2(ropes.windowDigest(a))) {
            done["resolveExit"]++;
            _record(id);
        } catch {}
    }

    function knockOut(uint256 seed, uint32 beyond) external {
        uint256 id = _pick(seed, 1 << uint8(RopesBase.State.Live));
        if (id == 0) return;
        RopesBase.Pot memory p = ropes.pot(id);
        if (p.expiry == 0) return;
        uint32 price = p.lower != 0 ? uint32(bound(beyond, 0, p.lower)) : uint32(bound(beyond, p.upper, P));
        RopesBase.WindowAttestation memory a = _att(id, 7, p.nonce, uint64(block.timestamp + 1), p.window, price, true);
        vm.warp(a.windowEnd);
        try ropes.triggerKnockOut(a, _sign2(ropes.windowDigest(a))) {
            done["knockOut"]++;
        } catch {}
    }

    function addLife(uint256 seed, uint8 side) external {
        uint256 id = _pick(seed, 1 << uint8(RopesBase.State.Live));
        if (id == 0) return;
        RopesBase.Pot memory p = ropes.pot(id);
        side = p.distYes != 0 ? 0 : (p.distNo != 0 ? 1 : side % 2); // the side with a post
        vm.prank(ropes.ownerOf(id * 2 + side));
        try ext.addLife(id, side, _noAuth()) {
            done["addLife"]++;
        } catch {}
    }

    function takeover(uint256 seed, uint256 actorSeed) external {
        uint256 id = _pick(seed, 1 << uint8(RopesBase.State.ExitRequested));
        if (id == 0) return;
        vm.prank(actors[actorSeed % 4]);
        try ext.takeover(id, _noAuth()) {
            done["takeover"]++;
        } catch {}
    }

    function resolveExpiry(uint256 seed, uint32 price, bool valid) external {
        uint256 id = _pick(seed, 1 << uint8(RopesBase.State.Live));
        if (id == 0) return;
        RopesBase.Pot memory p = ropes.pot(id);
        if (p.expiry == 0 || p.expiryTry >= 4) return;
        RopesBase.WindowAttestation memory a = _att(id, 8, p.nonce, ext.expiryWindowStart(id, p.expiryTry), p.window, uint32(bound(price, 0, P)), valid);
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        try ropes.resolveExpiry(a, _sign2(ropes.windowDigest(a))) {
            done["resolveExpiry"]++;
            _record(id);
        } catch {}
    }

    function settle(uint256 seed, uint8 outcome) external {
        uint256 id = _pick(seed, (1 << uint8(RopesBase.State.Live)) | (1 << uint8(RopesBase.State.ExitRequested)));
        if (id == 0) return;
        if (block.timestamp < closeOf[id]) {
            if (seed % 8 != 0) return; // rarely jump to trading close: it ends most pots
            vm.warp(closeOf[id]);
        }
        RopesBase.OutcomeAttestation memory o = RopesBase.OutcomeAttestation(id, COND, outcome % 3, keccak256("settled"));
        try ext.settle(o, _sign2(ext.outcomeDigest(o))) {
            done["settle"]++;
        } catch {}
        _recordAll();
    }

    function expire(uint256 seed) external {
        uint256 id = _pick(seed, 0x1E); // Open, Joining, Live, ExitRequested
        if (id == 0) return;
        uint64 dl = ropes.pot(id).deadline;
        if (block.timestamp < dl) {
            if (seed % 8 != 0) return; // rarely jump to the deadline
            vm.warp(dl);
        }
        try ext.expire(id) {
            done["expire"]++;
        } catch {}
        _recordAll();
    }

    function setReferrer(uint256 a, uint256 b) external {
        vm.prank(actors[a % 4]);
        try ext.setReferrer(actors[b % 4]) {
            done["setReferrer"]++;
        } catch {}
    }

    function transfer(uint256 seed, uint8 side, uint256 toSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        uint256 t = id * 2 + (side % 2);
        address owner;
        try ropes.ownerOf(t) returns (address o) {
            owner = o;
        } catch {
            return;
        }
        vm.prank(owner);
        try ropes.transferFrom(owner, actors[toSeed % 4], t) {
            done["transfer"]++;
        } catch {}
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 20 minutes));
    }
}

/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 400
contract RopesInvariants is Test {
    RopesHandler internal h;
    HonorCatRopes internal ropes;
    HonorCatRopesExtension internal ext;
    MockUSDC internal usdc;
    uint256 internal startTotal;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        uint256[3] memory pks = [uint256(0xA1), uint256(0xA2), uint256(0xA3)];
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
        HonorCatRopesExtension impl = new HonorCatRopesExtension(IERC20(address(usdc)));
        ropes = new HonorCatRopes(IERC20(address(usdc)), address(this), address(impl));
        ext = HonorCatRopesExtension(address(ropes));
        h = new RopesHandler(ropes, usdc, sorted, res);
        startTotal = _total();
        targetContract(address(h));
    }

    function _total() internal view returns (uint256 t) {
        for (uint256 i; i < 4; ++i) t += usdc.balanceOf(h.actors(i));
        t += usdc.balanceOf(address(ropes));
    }

    /// @notice What the contract holds is exactly what it owes: escrows of open offers and pending joins,
    ///         the pot value of running pots, takers' escrows, copy hold-backs and claimable amounts.
    function invariant_balanceEquation() public view {
        uint256 owed = ropes.totalClaimable();
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            RopesBase.Pot memory p = ropes.pot(id);
            if (p.state == RopesBase.State.Open || p.state == RopesBase.State.Joining) owed += p.escrowYes + p.escrowNo;
            if (p.state == RopesBase.State.Live || p.state == RopesBase.State.ExitRequested) {
                uint256 v = ext.potValue(p.size, p.lower, p.upper);
                owed += v;
                if (p.state == RopesBase.State.ExitRequested && p.joiner != address(0)) owed += v; // taker escrow
            }
            for (uint256 s; s < 2; ++s) {
                (,,, uint256 held) = ext.copies(id * 2 + s);
                owed += held;
            }
        }
        assertEq(usdc.balanceOf(address(ropes)), owed);
    }

    /// @notice Nothing is created or destroyed: players plus the contract always hold the starting total.
    function invariant_conservation() public view {
        assertEq(_total(), startTotal);
    }

    /// @notice A running pot's two shares always sum to its pot value at every price, posts included.
    function invariant_sharesSumToPot() public view {
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            RopesBase.Pot memory p = ropes.pot(id);
            if (p.state != RopesBase.State.Live && p.state != RopesBase.State.ExitRequested) continue;
            uint256 v = ext.potValue(p.size, p.lower, p.upper);
            uint32[4] memory prices = [uint32(0), p.lower, p.upper, uint32(1_000_000)];
            for (uint256 k; k < 4; ++k) {
                (uint256 y, uint256 no) = ext.shares(id, prices[k]);
                assertEq(y + no, v);
            }
            assertLe(p.lower, p.entry);
            assertGe(p.upper, p.entry);
        }
    }

    /// @notice Terminal states never change.
    function invariant_terminalFinal() public view {
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            uint8 seen = h.terminalSeen(id);
            if (seen != 0) assertEq(uint8(ropes.pot(id).state), seen);
        }
    }

    function afterInvariant() external view {
        // coverage: print how often each action succeeded (visible with -vv)
        string[13] memory k = ["create", "requestJoin", "resolveJoin", "requestExit", "resolveExit", "knockOut", "addLife", "takeover", "resolveExpiry", "settle", "expire", "setReferrer", "transfer"];
        for (uint256 i; i < k.length; ++i) console.log(k[i], h.done(k[i]));
    }

}
