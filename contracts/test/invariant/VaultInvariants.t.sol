// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VerdictVault} from "../../src/VerdictVault.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @dev Drives the vault through random but valid-looking sequences. Calls that revert in the vault
///      are swallowed (try/catch) so the fuzzer keeps exploring; ghost variables record what must
///      hold, and the invariant contract asserts it after every call.
contract VaultHandler is Test {
    VerdictVault public immutable vault;
    MockUSDC public immutable usdc;

    uint256 internal constant N_ACTORS = 6;
    uint256[N_ACTORS] internal actorPks = [uint256(0xA1), 0xA2, 0xA3, 0xA4, 0xA5, 0xA6];
    uint256 internal constant RESOLVER_PK = 0xBEEF;
    uint256 internal constant WRONG_PK = 0xBAD;

    // ---- ghosts
    uint256 public ghostMinted;
    uint256 public ghostDonated;
    uint256 public ghostDisbursementMismatches;
    uint256 public ghostStatusRegressions;
    uint256 public ghostSettledTotalChanges;
    uint256 public ghostWrongSignerAccepted;
    uint256 public ghostReplayAccepted;
    uint256 public ghostDustLeftAfterSettlement;
    mapping(uint256 => uint8) public ghostStatus; // last observed status
    mapping(uint256 => bool) public ghostOutcome;
    mapping(uint256 => uint256) public ghostSettledTotal;
    mapping(bytes32 => bool) internal usedAuth;

    mapping(bytes32 => uint256) public calls;
    /// successful (non-reverting) actions, to show the fuzzer reaches the interesting states
    mapping(bytes32 => uint256) public hits;

    constructor(VerdictVault vault_, MockUSDC usdc_) {
        vault = vault_;
        usdc = usdc_;
        for (uint256 i; i < N_ACTORS; ++i) {
            address a = vm.addr(actorPks[i]);
            usdc.mint(a, 1_000_000e6);
            ghostMinted += 1_000_000e6;
            vm.prank(a);
            usdc.approve(address(vault), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------ helpers

    function actor(uint256 seed) public view returns (address) {
        return vm.addr(actorPks[seed % N_ACTORS]);
    }

    function actorCount() external pure returns (uint256) {
        return N_ACTORS;
    }

    function _pot(uint256 seed) internal view returns (uint256 id, bool exists) {
        uint256 n = vault.potCount();
        if (n == 0) return (0, false);
        return (1 + (seed % n), true);
    }

    /// @dev Mostly picks a pot where the action can succeed (so the fuzzer reaches settlement,
    ///      deferral and claims); 1 in 5 picks stay uniformly random to keep failure paths covered.
    ///      kind 0 = fundable (open, before deadline), 1 = resolvable (open, funded, in window).
    function _pick(uint256 seed, uint8 kind) internal view returns (uint256 id, bool exists) {
        uint256 n = vault.potCount();
        if (n == 0) return (0, false);
        if (seed % 5 == 0) return (1 + (seed % n), true);
        for (uint256 k; k < n; ++k) {
            uint256 cand = 1 + ((seed + k) % n);
            VerdictVault.Pot memory p = vault.getPot(cand);
            if (p.status != VerdictVault.Status.Open) continue;
            if (kind == 0 && block.timestamp <= p.deadline) return (cand, true);
            if (kind == 1 && p.total > 0 && block.timestamp <= uint256(p.deadline) + vault.gracePeriod()) {
                return (cand, true);
            }
        }
        return (1 + (seed % n), true);
    }

    function _observe(uint256 id) internal {
        VerdictVault.Pot memory p = vault.getPot(id);
        uint8 prev = ghostStatus[id];
        uint8 cur = uint8(p.status);
        // Open(1) may move to Resolved(2) or Expired(3); nothing ever moves back or sideways.
        if (prev > 1 && cur != prev) ghostStatusRegressions++;
        if (prev == 2 && p.outcome != ghostOutcome[id]) ghostStatusRegressions++;
        if (prev > 1 && p.total != ghostSettledTotal[id]) ghostSettledTotalChanges++;
        if (cur > 1 && prev <= 1) {
            ghostOutcome[id] = p.outcome;
            ghostSettledTotal[id] = p.total;
        }
        ghostStatus[id] = cur;
    }

    /// @dev For a settlement call: USDC leaving the vault plus newly deferred (claimable) amounts
    ///      must equal exactly the pot total — no dust kept, nothing extra paid.
    function _settled(uint256 id, uint256 balBefore, uint256 claimBefore) internal {
        uint256 outflow = balBefore - usdc.balanceOf(address(vault));
        uint256 deferred = vault.totalClaimable() - claimBefore;
        if (outflow + deferred != vault.getPot(id).total) ghostDisbursementMismatches++;
        _observe(id);
    }

    // ------------------------------------------------------------------ actions

    function _split(uint256 seed, uint256 n) internal view returns (address[] memory payees, uint16[] memory shares) {
        payees = new address[](n);
        shares = new uint16[](n);
        uint256 left = 10_000;
        for (uint256 i; i < n; ++i) {
            payees[i] = actor(seed >> (i * 8));
            uint256 s = i == n - 1 ? left : bound(uint256(keccak256(abi.encode(seed, i))), 1, left - (n - 1 - i));
            shares[i] = uint16(s);
            left -= s;
        }
    }

    function createPot(uint256 seed, uint8 nPayees, uint32 deadlineIn, uint8 resolverSeed) external {
        calls["createPot"]++;
        (address[] memory payees, uint16[] memory shares) = _split(seed, bound(nPayees, 1, 4));
        vm.prank(actor(seed));
        uint256 id = vault.createPot(
            keccak256(abi.encode("c", seed)),
            resolverSeed % 8 == 0 ? vm.addr(WRONG_PK) : vm.addr(RESOLVER_PK), // 1 in 8: nobody we sign for
            payees,
            shares,
            actor(seed >> 3),
            uint64(block.timestamp + bound(deadlineIn, 1 hours, 2 days))
        );
        _observe(id);
    }

    function fund(uint256 potSeed, uint256 actorSeed, uint96 amount) external {
        calls["fund"]++;
        (uint256 id, bool ok) = _pick(potSeed, 0);
        if (!ok) return;
        address a = actor(actorSeed);
        uint256 amt = bound(amount, 1, usdc.balanceOf(a) / 4 + 1);
        vm.prank(a);
        try vault.fund(id, amt) {
            hits["fund"]++;
        } catch {}
        _observe(id);
    }

    function _authorize(uint256 pk, uint256 id, uint256 amt, bytes32 salt)
        internal
        view
        returns (VerdictVault.Authorization memory a, bytes32 nonce)
    {
        a.from = vm.addr(pk);
        a.validBefore = block.timestamp + 1 hours;
        a.salt = salt;
        nonce = vault.fundNonce(id, salt);
        bytes32 structHash = keccak256(
            abi.encode(usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), a.from, address(vault), amt, 0, a.validBefore, nonce)
        );
        (a.v, a.r, a.s) = vm.sign(pk, keccak256(abi.encodePacked(hex"1901", usdc.DOMAIN_SEPARATOR(), structHash)));
    }

    function fundWithAuthorization(uint256 potSeed, uint256 actorSeed, uint96 amount, bytes32 salt, bool replay)
        external
    {
        calls["fundWithAuthorization"]++;
        (uint256 id, bool ok) = _pick(potSeed, 0);
        if (!ok) return;
        uint256 pk = actorPks[actorSeed % N_ACTORS];
        uint256 amt = bound(amount, 1, usdc.balanceOf(vm.addr(pk)) / 4 + 1);
        (VerdictVault.Authorization memory a, bytes32 nonce) = _authorize(pk, id, amt, salt);
        bytes32 key = keccak256(abi.encode(a.from, nonce));
        bool wasUsed = usedAuth[key];
        try vault.fundWithAuthorization(id, amt, a) {
            if (wasUsed) ghostReplayAccepted++;
            usedAuth[key] = true;
            hits["fundWithAuthorization"]++;
        } catch {}
        if (replay) {
            try vault.fundWithAuthorization(id, amt, a) {
                ghostReplayAccepted++;
            } catch {}
        }
        _observe(id);
    }

    function resolve(uint256 potSeed, bool outcome, uint8 signerSeed) external {
        bool wrongSigner = signerSeed % 8 == 0; // 1 in 8 attempts uses a key that is not the resolver
        calls["resolve"]++;
        (uint256 id, bool ok) = _pick(potSeed, 1);
        if (!ok) return;
        VerdictVault.Pot memory p = vault.getPot(id);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(wrongSigner ? 0xC0FFEE : RESOLVER_PK, vault.resolutionDigest(id, p.conditionId, outcome));
        uint256 balBefore = usdc.balanceOf(address(vault));
        uint256 claimBefore = vault.totalClaimable();
        try vault.resolve(id, outcome, abi.encodePacked(r, s, v)) {
            if (wrongSigner || p.resolver != vm.addr(RESOLVER_PK)) ghostWrongSignerAccepted++;
            if (outcome) hits["resolveTrue"]++;
            else hits["resolveFalse"]++;
            if (vault.totalClaimable() > claimBefore) hits["deferredPayment"]++;
            _settled(id, balBefore, claimBefore);
        } catch {
            _observe(id);
        }
    }

    function expire(uint256 potSeed) external {
        calls["expire"]++;
        (uint256 id, bool ok) = _pot(potSeed);
        if (!ok) return;
        uint256 balBefore = usdc.balanceOf(address(vault));
        uint256 claimBefore = vault.totalClaimable();
        try vault.expire(id) {
            hits["expire"]++;
            _settled(id, balBefore, claimBefore);
        } catch {
            _observe(id);
        }
    }

    function claim(uint256 actorSeed) external {
        calls["claim"]++;
        vm.prank(actor(actorSeed));
        try vault.claim() {
            hits["claim"]++;
        } catch {}
    }

    function toggleBlocklist(uint256 actorSeed) external {
        calls["toggleBlocklist"]++;
        address a = actor(actorSeed);
        usdc.setBlocked(a, !usdc.blocked(a));
    }

    function donate(uint256 actorSeed, uint96 amount) external {
        calls["donate"]++;
        address a = actor(actorSeed);
        uint256 amt = bound(amount, 0, usdc.balanceOf(a) / 10);
        vm.prank(a);
        try usdc.transfer(address(vault), amt) {
            ghostDonated += amt;
        } catch {}
    }

    function warp(uint32 secs) external {
        calls["warp"]++;
        vm.warp(block.timestamp + bound(secs, 1, 6 hours));
    }

    /// @dev Settles everything (expiring after the grace period) and lets everyone claim, then
    ///      records whether the vault holds anything beyond donations.
    function settleAllAndClaim() external {
        hits["settleAll"]++;
        vm.warp(block.timestamp + 4 days + vault.gracePeriod());
        for (uint256 i; i < N_ACTORS; ++i) {
            usdc.setBlocked(actor(i), false);
        }
        uint256 n = vault.potCount();
        for (uint256 id = 1; id <= n; ++id) {
            if (vault.getPot(id).status == VerdictVault.Status.Open) {
                uint256 balBefore = usdc.balanceOf(address(vault));
                uint256 claimBefore = vault.totalClaimable();
                vault.expire(id);
                _settled(id, balBefore, claimBefore);
            }
        }
        for (uint256 i; i < N_ACTORS; ++i) {
            vm.prank(actor(i));
            try vault.claim() {} catch {}
        }
        if (usdc.balanceOf(address(vault)) != ghostDonated) ghostDustLeftAfterSettlement++;
    }
}

/// Invariants (all must hold after every call of every random sequence):
///  1. Solvency: vault USDC == sum(open pot totals) + totalClaimable (+ USDC donated directly).
///  2. totalClaimable == sum of claimable[account] over all accounts that ever held a claim.
///  3. Conservation: USDC is neither created nor destroyed (actors + vault == minted).
///  4. Exact disbursement: every settlement moves out or defers exactly the pot total (no dust).
///  5. Settlement is final: a settled pot never changes status, outcome or total.
///  6. Only the pot's resolver can settle it; wrong signers are never accepted.
///  7. EIP-3009 authorizations cannot be replayed.
///  8. After settling everything and claiming, the vault holds exactly the donated amount (0 dust).
///  9. Pot ids are sequential: every id in 1..potCount exists, none beyond it (BatchGuard relies on this).
contract VaultInvariants is StdInvariant, Test {
    VerdictVault vault;
    MockUSDC usdc;
    VaultHandler handler;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new VerdictVault(IERC20(address(usdc)), 1 hours);
        handler = new VaultHandler(vault, usdc);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = VaultHandler.createPot.selector;
        selectors[1] = VaultHandler.fund.selector;
        selectors[2] = VaultHandler.fundWithAuthorization.selector;
        selectors[3] = VaultHandler.resolve.selector;
        selectors[4] = VaultHandler.expire.selector;
        selectors[5] = VaultHandler.claim.selector;
        selectors[6] = VaultHandler.toggleBlocklist.selector;
        selectors[7] = VaultHandler.donate.selector;
        selectors[8] = VaultHandler.warp.selector;
        selectors[9] = VaultHandler.createPot.selector; // weight pot creation
        selectors[10] = VaultHandler.resolve.selector; // weight resolution
        selectors[11] = VaultHandler.fund.selector; // weight funding
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _openSum() internal view returns (uint256 sum) {
        uint256 n = vault.potCount();
        for (uint256 id = 1; id <= n; ++id) {
            VerdictVault.Pot memory p = vault.getPot(id);
            if (p.status == VerdictVault.Status.Open) sum += p.total;
        }
    }

    function invariant_solvency() public view {
        assertEq(usdc.balanceOf(address(vault)), _openSum() + vault.totalClaimable() + handler.ghostDonated());
    }

    function invariant_claimableSum() public view {
        uint256 sum;
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += vault.claimable(handler.actor(i));
        }
        assertEq(vault.totalClaimable(), sum);
    }

    function invariant_conservation() public view {
        uint256 sum = usdc.balanceOf(address(vault));
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += usdc.balanceOf(handler.actor(i));
        }
        assertEq(sum, handler.ghostMinted());
    }

    function invariant_exactDisbursement() public view {
        assertEq(handler.ghostDisbursementMismatches(), 0);
    }

    function invariant_settlementIsFinal() public view {
        assertEq(handler.ghostStatusRegressions(), 0);
        assertEq(handler.ghostSettledTotalChanges(), 0);
    }

    function invariant_onlyResolverSettles() public view {
        assertEq(handler.ghostWrongSignerAccepted(), 0);
    }

    function invariant_noAuthorizationReplay() public view {
        assertEq(handler.ghostReplayAccepted(), 0);
    }

    function invariant_noDustAfterFullSettlement() public view {
        assertEq(handler.ghostDustLeftAfterSettlement(), 0);
    }

    function invariant_sequentialIds() public view {
        uint256 n = vault.potCount();
        for (uint256 id = 1; id <= n; ++id) {
            assertTrue(vault.getPot(id).status != VerdictVault.Status.None);
        }
        assertTrue(vault.getPot(n + 1).status == VerdictVault.Status.None);
    }

    /// Logs how often each action actually succeeded (run with -vv), as evidence that the
    /// random sequences reach settlement, deferred payments and claims, not just reverts.
    function afterInvariant() external {
        // End of every random sequence: settle everything, let everyone claim, and require that
        // exactly the directly donated USDC is left (no dust, nothing stuck).
        handler.settleAllAndClaim();
        assertEq(handler.ghostDustLeftAfterSettlement(), 0);
        assertEq(usdc.balanceOf(address(vault)), handler.ghostDonated());
        assertEq(vault.totalClaimable(), 0);
        string[8] memory k = [
            "fund",
            "fundWithAuthorization",
            "resolveTrue",
            "resolveFalse",
            "expire",
            "claim",
            "deferredPayment",
            "settleAll"
        ];
        for (uint256 i; i < k.length; ++i) {
            bytes32 key = bytes32(bytes(k[i]));
            uint256 n = handler.hits(key);
            console.log(k[i], n);
        }
    }
}
