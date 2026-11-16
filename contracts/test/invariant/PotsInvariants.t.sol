// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatPots} from "../../src/HonorCatPots.sol";
import {MultisigResolver} from "../../src/resolvers/MultisigResolver.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Drives random sequences of every pot action with properly signed attestations.
contract PotsHandler is Test {
    HonorCatPots public pots;
    MockUSDC public usdc;
    uint256[] internal sorted;
    address[4] public actors;
    uint256[] public ids;
    bytes32 constant COND = keccak256("GEMI-INV|rule");
    uint64 public closeTime;
    mapping(uint256 => uint8) public terminalSeen; // potId -> terminal state seen (0 = none)

    MultisigResolver internal _res;
    mapping(string => uint256) public done; // successful state-changing calls per action

    constructor(HonorCatPots pots_, MockUSDC usdc_, uint256[] memory sorted_, uint64 closeTime_, MultisigResolver res_) {
        _res = res_;
        pots = pots_;
        usdc = usdc_;
        sorted = sorted_;
        closeTime = closeTime_;
        for (uint256 i; i < 4; ++i) {
            actors[i] = address(uint160(0xA000 + i));
            usdc.mint(actors[i], 10_000e6);
            vm.prank(actors[i]);
            usdc.approve(address(pots), type(uint256).max);
        }
    }

    function _sign2(bytes32 d) internal view returns (bytes memory) {
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(sorted[0], d);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(sorted[1], d);
        return bytes.concat(abi.encodePacked(r1, s1, v1), abi.encodePacked(r2, s2, v2));
    }

    function _noAuth() internal pure returns (HonorCatPots.Authorization memory a) {}

    /// @dev A pot whose state is in `mask` (bit i = State(i)), searching from a random start; 0 if none.
    function _pick(uint256 seed, uint256 mask) internal view returns (uint256) {
        uint256 n = ids.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = ids[(seed + i) % n];
            if (mask & (1 << uint8(pots.pot(id).state)) != 0) return id;
        }
        return 0;
    }

    function _record(uint256 id) internal {
        HonorCatPots.State s = pots.pot(id).state;
        if (s == HonorCatPots.State.Divided || s == HonorCatPots.State.Settled || s == HonorCatPots.State.Expired) {
            if (terminalSeen[id] == 0) terminalSeen[id] = uint8(s);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    // ---------------------------------------------------------------- actions

    function create(uint256 actorSeed, uint8 side, uint256 n, uint32 center, uint32 tol) external {
        uint64 close = uint64(block.timestamp + 3 days); // each pot its own trading close
        address who = actors[actorSeed % 4];
        side = side % 2;
        n = bound(n, 1, 25e6);
        center = uint32(bound(center, 0, 1_000_000));
        tol = uint32(bound(tol, 0, 50_000));
        HonorCatPots.CreateParams memory c = HonorCatPots.CreateParams(COND, address(0), side, n, center, tol, close, 1 days, 20, 5);
        c.resolver = address(_resolver());
        HonorCatPots.DepthAttestation memory d = HonorCatPots.DepthAttestation(COND, who, 1_000_000, close, uint64(block.timestamp + 60));
        bytes memory sigs = _sign2(pots.depthDigest(d));
        vm.prank(who);
        ids.push(pots.create(c, d, sigs, _noAuth())); done["create"]++;
    }

    function requestJoin(uint256 potSeed, uint256 actorSeed) external {
        uint256 id = _pick(potSeed, 2);
        if (id == 0) return;
        HonorCatPots.Pot memory p = pots.pot(id);
        if (p.state != HonorCatPots.State.Open || block.timestamp + pots.lockout(id) >= p.closeTime) return;
        vm.prank(actors[actorSeed % 4]);
        pots.requestJoin(id, _noAuth()); done["requestJoin"]++;
    }

    function resolveWindow(uint256 potSeed, uint32 price, bool valid) external {
        uint256 id = _pick(potSeed, 20);
        if (id == 0) return;
        HonorCatPots.Pot memory p = pots.pot(id);
        bool joining = p.state == HonorCatPots.State.Joining;
        if (!joining && p.state != HonorCatPots.State.ExitRequested) return;
        price = uint32(bound(price, 0, 1_000_000));
        HonorCatPots.WindowAttestation memory a = HonorCatPots.WindowAttestation(
            id, joining ? 0 : 1, p.nonce, p.requestTime + 1, p.requestTime + 1 + p.window, 30, price, valid, keccak256(abi.encode(id, p.nonce))
        );
        if (block.timestamp < a.windowEnd) vm.warp(a.windowEnd);
        bytes memory sigs = _sign2(pots.windowDigest(a));
        if (joining) pots.resolveJoin(a, sigs);
        else pots.resolveExit(a, sigs); done["resolve"]++;
        _record(id);
    }

    function requestExit(uint256 potSeed, uint8 side, uint256 n) external {
        uint256 id = _pick(potSeed, 8);
        if (id == 0) return;
        HonorCatPots.Pot memory p = pots.pot(id);
        side = side % 2;
        if (p.state != HonorCatPots.State.Live || block.timestamp + pots.lockout(id) >= p.closeTime || block.timestamp < p.cooldownUntil) return;
        n = bound(n, 1, p.notional);
        address owner_ = pots.ownerOf(pots.tokenOf(id, side));
        vm.prank(owner_);
        pots.requestExit(id, side, n); done["requestExit"]++;
    }

    function takeover(uint256 potSeed, uint256 actorSeed) external {
        uint256 id = _pick(potSeed, 16);
        if (id == 0) return;
        HonorCatPots.Pot memory p = pots.pot(id);
        if (p.state != HonorCatPots.State.ExitRequested || p.joiner != address(0) || p.exitNotional != p.notional) return;
        if (block.timestamp >= p.requestTime + 1 + p.window) return;
        vm.prank(actors[actorSeed % 4]);
        pots.takeover(id, _noAuth()); done["takeover"]++;
    }

    /// A full exit followed at once by a third party's takeover (the window is only W seconds long).
    function exitWithTakeover(uint256 potSeed, uint8 side, uint256 actorSeed) external {
        uint256 id = _pick(potSeed, 8);
        if (id == 0) return;
        HonorCatPots.Pot memory p = pots.pot(id);
        side = side % 2;
        if (block.timestamp + pots.lockout(id) >= p.closeTime || block.timestamp < p.cooldownUntil) return;
        vm.prank(pots.ownerOf(pots.tokenOf(id, side)));
        pots.requestExit(id, side, p.notional);
        vm.prank(actors[actorSeed % 4]);
        pots.takeover(id, _noAuth());
        done["takeover"]++;
    }

    function settle(uint256 potSeed, uint8 outcome) external {
        uint256 id = _pick(potSeed, 24);
        if (id == 0) return;
        HonorCatPots.Pot memory p = pots.pot(id);
        if (p.state != HonorCatPots.State.Live && p.state != HonorCatPots.State.ExitRequested) return;
        if (block.timestamp < p.closeTime) return;
        HonorCatPots.OutcomeAttestation memory o = HonorCatPots.OutcomeAttestation(id, COND, outcome % 3, bytes32(0));
        pots.settle(o, _sign2(pots.outcomeDigest(o))); done["settle"]++;
        _record(id);
    }

    function expire(uint256 potSeed) external {
        uint256 id = _pick(potSeed, 30);
        if (id == 0) return;
        HonorCatPots.Pot memory p = pots.pot(id);
        HonorCatPots.State s = p.state;
        if (s == HonorCatPots.State.Divided || s == HonorCatPots.State.Settled || s == HonorCatPots.State.Expired) return;
        if (block.timestamp < p.deadline) return;
        pots.expire(id); done["expire"]++;
        _record(id);
    }

    function cancel(uint256 potSeed) external {
        uint256 id = _pick(potSeed, 2);
        if (id == 0 || pots.pot(id).state != HonorCatPots.State.Open) return;
        HonorCatPots.Pot memory p = pots.pot(id);
        vm.prank(pots.ownerOf(pots.tokenOf(id, p.creatorSide)));
        pots.cancel(id); done["cancel"]++;
        _record(id);
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + (secs % 4 == 0 ? bound(secs, 1 hours, 2 days) : bound(secs, 1, 5 minutes)));
    }

    function _resolver() internal view returns (MultisigResolver) {
        return _res;
    }
}

/// @notice Properties that must hold after any sequence of calls.
/// forge-config: default.invariant.depth = 200
/// forge-config: default.invariant.runs = 128
contract PotsInvariants is Test {
    HonorCatPots pots;
    MockUSDC usdc;
    PotsHandler handler;
    uint256 totalSupply0;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        uint256[3] memory pks = [uint256(0x5A1), uint256(0x5A2), uint256(0x5A3)];
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
        pots = new HonorCatPots(IERC20(address(usdc)), address(this));
        handler = new PotsHandler(pots, usdc, sorted, uint64(block.timestamp + 3 days), res);
        targetContract(address(handler));
        totalSupply0 = usdc.totalSupply();
    }

    /// The contract holds exactly what its pots, escrows and claimables account for.
    function invariant_balanceMatchesBooks() public view {
        uint256 owed = pots.totalClaimable();
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            HonorCatPots.Pot memory p = pots.pot(handler.ids(i));
            if (p.state == HonorCatPots.State.Open || p.state == HonorCatPots.State.Joining) owed += p.escrowYes + p.escrowNo;
            if (p.state == HonorCatPots.State.Live || p.state == HonorCatPots.State.ExitRequested) owed += p.notional;
            if (p.state == HonorCatPots.State.ExitRequested && p.joiner != address(0)) owed += p.notional; // taker escrow
        }
        assertEq(usdc.balanceOf(address(pots)), owed);
    }

    /// Deposits always back exactly the pot while it runs.
    function invariant_depositsSumToNotional() public view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            HonorCatPots.Pot memory p = pots.pot(handler.ids(i));
            if (p.state == HonorCatPots.State.Live || p.state == HonorCatPots.State.ExitRequested) {
                assertEq(p.depYes + p.depNo, p.notional);
                assertGt(p.notional, 0);
            }
        }
    }

    /// A terminal state never changes again.
    function invariant_terminalStatesAreFinal() public view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            uint8 seen = handler.terminalSeen(id);
            if (seen != 0) assertEq(uint8(pots.pot(id).state), seen);
        }
    }

    /// Coverage report (not a property): how many calls of each kind changed state.
    function afterInvariant() public view {
        string[8] memory k = ["create", "requestJoin", "resolve", "requestExit", "takeover", "settle", "expire", "cancel"];
        for (uint256 i; i < 8; ++i) console.log(k[i], handler.done(k[i]));
    }

    /// No unit of USDC is created or destroyed anywhere.
    function invariant_supplyConserved() public view {
        assertEq(usdc.totalSupply(), totalSupply0);
    }
}
