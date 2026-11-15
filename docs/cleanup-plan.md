# Cleanup plan (C0, 2026-11-15)

Inventory for "HonorCat: money in the air" (two sides, one pot, one Gemini contract). Nothing has
been changed. Marks: **KEEP** (stays as is), **REWORK** (stays, changed for the new product),
**REMOVE** (goes; moved to `docs/archive` or `*/archive` where it documents history), **RETIRE**
(on-chain or stored data that cannot or must not be deleted: kept read-only and listed as retired).

Rules for C1, from the spec: work on a branch, tag the current state first (`pre-cleanup`), small
commits, tests green after every step, no deletion of database data and no change to deployed
contracts without asking.

## 1. On-chain contracts (Arc testnet, chain 5042002)

| Contract | Address | Mark | Why |
|---|---|---|---|
| VerdictVault | 0xba71…E6D4 | RETIRE | One-sided conditional pots; the new product needs a two-sided pot contract (D1). Existing pots must still settle or expire, so the relay keeps settling them until none is open, then stops. Listed in the README as retired. |
| GuaranteeBook | 0x2C59…6774 | RETIRE | Refund guarantees and the early-payout recipient list; both products end. |
| BatchGuard | 0xf040…8AEE | RETIRE | Atomic batches for guarantees. |
| MerkleBook | 0x308b…867e | RETIRE | Merkle "drops". |
| MultisigResolver (2-of-3 samplers) | 0x81d1…36c9 | KEEP | The spec keeps the multi-signer resolver; D0 decides whether the new contract calls it or verifies EIP-712 attestations from the same signer set itself. |
| PasskeyAccount + Factory | 0xCe60…2c65 / 0xB93e…0ea2 | KEEP | Passkey accounts stay. |
| Arc system contracts used (USDC 0x3600…, Memo, Multicall3From) | from Arc docs | KEEP | Spec section 6. |

Source files:

| File | Mark | Why |
|---|---|---|
| contracts/src/VerdictVault.sol | RETIRE → `contracts/archive/` | Deployed and still settling; source kept for the record, out of the build. |
| contracts/src/GuaranteeBook.sol, BatchGuard.sol, MerkleBook.sol | RETIRE → `contracts/archive/` | Same. |
| contracts/src/resolvers/MultisigResolver.sol | KEEP | See above. |
| contracts/src/passkey/* | KEEP | |
| contracts/src/interfaces/IERC3009.sol | KEEP | Gasless join and exit. |
| contracts/script/Deploy.s.sol, DeployGuarantees.s.sol, DeployMerkle.s.sol | RETIRE → archive | Deployments done; never rerun. |
| contracts/script/DeployPasskeys.s.sol, DeploySamplers.s.sol | KEEP | |
| contracts/test/VerdictVault.t.sol, GuaranteeBook.t.sol, MerkleBook.t.sol, Gasless.t.sol, Fuzz.t.sol, invariant/* | RETIRE → archive | Test retired contracts; the new contract gets its own unit, fuzz, invariant and symbolic tests (D1). |
| contracts/test/PasskeyAccount.t.sol, mocks/* | KEEP | |
| deployments/5042002*.json | KEEP, split | Keep for the record; add `deployments/retired.md` and one current file for active contracts. |

## 2. Relay (`relay/src`, package `@verdict/relay`)

| Module | Mark | Why |
|---|---|---|
| trigger/engine.ts, evidence.ts, params.ts, index.ts | KEEP / REWORK | The sampling engine and deterministic evidence format stay. Add a forward exit-window average (samples after the request only) and net/bowl thresholds (D2). |
| sampler.ts, samplerHost.ts | REWORK | Keep the three independent samplers; they sample pots with open exit windows and nets/bowls instead of armed early-payout pots. |
| catalog.ts | KEEP | The quality-sorted market list. |
| indexer/ingest.ts, quicknode.ts, rpcPoller.ts | REWORK | Same pipeline (Streams primary, RPC fallback, receipts), decoding the new pot events. |
| streams.ts, status.ts, txs.ts, arc.ts, memo.ts, chain.ts | KEEP (small rework) | Streams overview, relay status, the single send path (Multicall3From), Arc fee and decimals handling, Memo. Prune vault-specific bits. |
| passkeys.ts, softPasskey.ts | KEEP | |
| gasless.ts | REWORK | EIP-3009 authorizations, retargeted from the vault to the new contract (join, create, exit fee). |
| signer.ts, resolver.ts | REWORK | Vault resolution signing becomes price-attestation signing (D0/D2). |
| sources/gemini.ts | REWORK | Gemini settlement reading stays (ends pots nobody left). |
| sources/api.ts, http.ts, manual.ts, sources/types.ts | REMOVE | Outcome sources for the vault's generic conditions; not used by the new product. |
| conditions.ts | REMOVE | Vault condition registry. |
| api.ts (vault pots and payments DTOs) | REMOVE | Replaced by new pot reads. |
| early.ts | REMOVE (after reuse) | Early-payout lifecycle. Pieces worth keeping move: attestation aggregation and evidence-root handling into the new pot module. |
| guarantees.ts, drops.ts | REMOVE | Products ended. |
| integrations.ts, webhooks.ts | REMOVE | Integrator API keys and webhooks for the old platform API. A read API for pots and positions is part of D5 (developers page), built fresh. |
| tick.ts | REWORK | One lease-guarded tick: index, settle, expire, deliver attestations. |
| config.ts | REWORK | Prune env vars (section 6). |
| db.ts | REWORK | New tables for pots, sides, exits; old tables kept read-only (section 5). |
| abi.ts | REWORK | Regenerated for the new contract. |
| index.ts | REWORK | Exports follow the module changes. |

Scripts and tests:

| File | Mark | Why |
|---|---|---|
| relay/scripts/e2e.ts | REWORK | New runs: held to settlement, ended by exit, handshake, takeover (section 10). |
| relay/scripts/sampler.ts, gen-abi.ts, quicknode-stream.ts | KEEP (rework) | Stream filter retargeted to the new contract. |
| relay/scripts/create-early.ts, create-guarantee.ts, bench-batch.ts | REMOVE | Old products. |
| relay/scripts/probe-arc-extensions.ts | REMOVE → archive | One-off probe of Memo/Multicall3From; findings are in the README. |
| relay/test/trigger, sampler, catalog, gemini, memo, passkeys, streams | KEEP | |
| relay/test/relay.test.ts | REWORK | Vault flows replaced by pot flows. |
| relay/test/drops.test.ts, platform.test.ts | REMOVE | Old products and the integration API. |

## 3. Web pages (`web/src/app`)

| Route | Mark | Why / becomes |
|---|---|---|
| `/` (Landing.tsx) | REWORK | One live pot in the rope view. |
| `/early/new` | REWORK → `/pots/new` | Create a pot: market picker (catalogue), side, N, price tolerance, cross-chain funding. |
| `/e/[id]` | REWORK → `/pots/[id]` | The pot with the rope view; invite and join. |
| `/e/[id]/proof` | REWORK → `/pots/[id]/proof` | Hashes and computed values public; raw samples for the two sides (existing session mechanism). |
| new | `/pots/[id]/terms`, `/pots/[id]/tv`, `/me` (my pots), `/honor/[address]`, `/design/cat`, `/how-it-is-built` | Spec sections 3, 6, 7, 8. |
| `/markets` | KEEP | |
| `/live`, `/status`, `/ledger` | KEEP (rework) | Live data flow and ledger show the new pot events and which path delivered them. |
| `/developers` | REWORK | Pots and positions as a building block. |
| `/how` | REWORK → `/pots/[id]/terms` plus a short general page | |
| `/account` | REWORK → `/me` | My pots and balance (passkey or wallet). |
| `/g/[id]`, `/g/[id]/proof`, `/guarantees`, `/guarantees/new` | REMOVE | Guarantees end. |
| `/d/[id]` | REMOVE | Drops end. |
| `/pots`, `/pots/[id]` (vault pots) | REMOVE (route reused) | The new pot pages take these URLs. |
| `not-found` | REWORK | The cat looks into an empty box. |

API routes:

| Route | Mark |
|---|---|
| /api/catalog, /api/catalog/quote, /api/markets | KEEP (merge /api/markets into /api/catalog) |
| /api/cctp/receive | KEEP |
| /api/passkeys/*, /api/accounts/[address] | KEEP (rework accounts to list pots) |
| /api/webhooks/quicknode, /api/streams, /api/status, /api/health, /api/chain/live, /api/cron/tick | KEEP |
| /api/early/[id]/evidence, /evidence/session | REWORK → /api/pots/[id]/evidence |
| /api/early/armed, /[id]/sign, /[id]/samples | REWORK → sampler endpoints for exit windows, nets and bowls |
| /api/early/demo, /early/history | REWORK (demo pots; trade-price history) |
| /api/early, /early/[id], /early/prepare, /early/[id]/join | REWORK → /api/pots… |
| /api/early/markets | REMOVE (no caller; replaced by /api/catalog) |
| /api/landing | REWORK |
| /api/gasless/* | REWORK (new contract) |
| /api/withdraw, /withdraw/prepare, /passkeys/withdraw* | KEEP (passkey account withdrawals) |
| /api/guarantees/*, /api/drops/*, /api/conditions, /api/admin/*, /api/v1/*, /api/pots (vault), /api/payments | REMOVE |

Components and libraries:

| Item | Mark | Why |
|---|---|---|
| components/cat/tokens.ts, Chrome.tsx, Markets.tsx, PayFrom.tsx, WalletChoice.tsx, RollingNumber.tsx | KEEP | |
| components/cat/shapes.tsx | REWORK | Becomes the single cute cat component with poses (D3, after the pose sheet). |
| components/cat/CatScale.tsx | REWORK → Rope | The 0–100 rope with posts, names, shares, net and bowl. |
| components/cat/PounceChart.tsx, StateRail.tsx | REWORK | Price path and pot states. |
| components/cat/CostView.tsx | REMOVE | The early-payout cost view; the rope's live shares replace it. |
| components/early/ProbabilityChart.tsx | REWORK | Price chart with exit windows. |
| components/guarantee/* (GuaranteeCard, LockedBadge, MarketPicker, SettlementRail, UnderTheHood, VerdictMoment), brand/HonorCatMark.tsx | REMOVE | Guarantee product; the old picker is superseded by Markets.tsx. |
| components/WalletButton.tsx | REMOVE | No importers. |
| components/LiveLine.tsx, TechMode.tsx | KEEP | |
| components/ui.tsx | REWORK | Drop the vault StatusBadge; keep Addr/Tx/Field. |
| lib/wallet/device.ts (DeviceWallet) | REMOVE | No importers; passkeys replaced it. |
| lib/guarantees.ts, lib/gasless.ts | REMOVE / REWORK | Guarantee helpers go; gasless signing is retargeted. |
| lib/useNow.ts | KEEP if still used after removals | |
| lib/cctp.ts, solana.ts, wallet/*, passkey.ts, evidence.ts, useEvidence.ts, api.ts, chain.ts, format.ts | KEEP | |
| server/catalog.ts, evidence.ts, gemini.ts, webauthn.ts, relay.ts | KEEP (rework evidence for pots) | |
| server/early.ts | REWORK | Demo market finder moves onto the catalogue (no hardcoded category list). |
| server/landing.ts | REWORK | One live pot. |
| server/guarantees.ts, drops.ts, terms.ts, exists.ts | REMOVE / REWORK | Terms sealing is reused for pot terms; the rest goes. |
| app/globals.css | REWORK | Remove the old `--vg-*` names, the packet animations if /live no longer needs them, `.vg-ticket`. |

## 4. SDK, CI, scripts

| Item | Mark | Why |
|---|---|---|
| sdk/ (`@verdict/sdk`-style client for the v1 integration API) | REMOVE now, rebuild in D5 | The API it wraps goes away; D5 can ship a small client for pots and positions. |
| .github/workflows/ci.yml | KEEP (rework) | Contract, relay, SDK and web checks plus Slither, pointed at the new layout. |
| .github/workflows/sampler.yml | KEEP | The GitHub-hosted sampler (still needs `SAMPLER_KEY_GITHUB`). |
| scripts/check-secrets.mjs | KEEP | |

## 5. Database tables (Neon production; no data deleted without your approval)

| Table | Mark | Why |
|---|---|---|
| market_catalog, passkeys, gasless_requests, memos, relay_state, relay_lease, relay_txs, relay_tx_pots, stream_batches | KEEP | Shared infrastructure. |
| chain_events | KEEP (rework) | Indexed events; new contract's events go here with a contract tag. |
| early_pots, early_samples, early_signatures | RETIRE | Stop writing; keep the history (proof pages for past payouts stay readable). |
| pots, resolutions, conditions, api_outcomes, manual_outcomes | RETIRE | Vault data; read-only until all vault pots are settled. |
| guarantees, drops, drop_entries, integrations, webhook_deliveries | RETIRE | Old products; keep the data, stop writing. |
| new | REWORK | `pots`, `sides`, `exits`, `attestations`, `honor` style tables for the new contract (names decided in D0). The current `pots` table name collides: proposal is to rename the old one to `vault_pots` in C1 (a rename, not a deletion; needs your approval). |

## 6. Environment variables

| Variable | Mark |
|---|---|
| ARC_RPC_URL, ARC_CHAIN_ID, USDC_ADDRESS, DATABASE_URL, PGLITE_DIR, DEPLOYMENTS_FILE | KEEP |
| DEPLOYER_PRIVATE_KEY | KEEP (deploys only) |
| RESOLVER_PRIVATE_KEY | KEEP, rename to RELAY_PRIVATE_KEY (it is the relay's sending key) |
| SAMPLER_KEY, SAMPLER_KEY_LOCAL, SAMPLER_KEY_VERCEL, SAMPLER_KEY_GITHUB, EARLY_SAMPLERS, EARLY_RESOLVER_ADDRESS | KEEP, rename EARLY_* to SAMPLERS / RESOLVER_ADDRESS |
| ADMIN_TOKEN, CRON_SECRET | KEEP |
| INDEXER_PRIMARY, QUICKNODE_STREAMS_TOKEN, QUICKNODE_API_KEY, QUICKNODE_STREAM_ID, TICK_MIN_INTERVAL_MS | KEEP |
| GASLESS_MIN_AMOUNT, GASLESS_MAX_PER_HOUR, RELAY_LOW_BALANCE_USDC | KEEP |
| PASSKEY_FACTORY_ADDRESS, GEMINI_API_BASE, NEXT_PUBLIC_RPC_URL, VERCEL | KEEP |
| VAULT_ADDRESS, VAULT_DEPLOY_BLOCK, NEXT_PUBLIC_VAULT_ADDRESS, GRACE_PERIOD_SECONDS, AUTO_EXPIRE | KEEP until the vault's last pot settles, then REMOVE |
| GUARANTEE_BOOK_ADDRESS, BATCH_GUARD_ADDRESS, GUARANTEES_DEPLOY_BLOCK, MERKLE_BOOK_ADDRESS | REMOVE (after the last guarantee/early pot settles) |
| HTTP_SOURCE_ALLOW_INSECURE, VERDICT_KEY, VERDICT_WEBHOOK_SECRET, PASSKEY_WITHDRAW_ANY | REMOVE (old sources, SDK, a test switch) |
| E2E_* | REWORK with the new e2e |
| new: POT_CONTRACT_ADDRESS (D1) | ADD |

## 7. Docs

| Doc | Mark |
|---|---|
| README.md | REWORK (C1): what it is, architecture diagram, setup, run, test, deploy, dated build log, retired contracts |
| docs/rubric.md | REPLACE (C1) with one that matches this spec, including an acceptance check per sponsor item |
| docs/PROGRESS.md | KEEP |
| docs/market-quality.md | KEEP |
| docs/threat-model.md | REWORK (D0: new attacks from section 4) |
| docs/early-payout-trigger.md | REWORK → docs/price-and-evidence.md (the engine and record format stay) |
| docs/design/landing.html, recipient-card.html | KEEP (design reference) |
| docs/early-payout-spec.md, forward-spec.md, guard-spec.md, improve.md, rubric-evidence.md, demo-script.md, devpost.md, BACKLOG.md | ARCHIVE → docs/archive/ |
| docs/cleanup-plan.md | this file |

## 8. Dead code and duplication

- **Two market pickers**: `components/guarantee/MarketPicker.tsx` (old) and `components/cat/Markets.tsx`.
- **Four Gemini readers**: `web/src/server/gemini.ts`, `relay/src/sources/gemini.ts`, the sampler's
  own fetch, and `web/src/server/catalog.ts` fetchJson. Proposal: one client in the relay.
- **Three WebSocket order-book readers**: `observeBooks` (server/early.ts), `depthOverWebSocket`
  (server/catalog.ts), `WsBookSource` (relay/src/sampler.ts). Proposal: one.
- **Demo finder vs catalogue**: `demoCandidates` re-implements quality checks with a hardcoded list
  of 7 categories; the catalogue already measures every contract.
- **Rule constants duplicated** in `components/cat/CostView.tsx`, `NewEarly.tsx` and
  `relay/src/trigger/params.ts`.
- **`evidenceMessage` duplicated** in `web/src/lib/evidence.ts` and `relay/scripts/e2e.ts`.
- **Unused**: `components/WalletButton.tsx`, `lib/wallet/device.ts`, `/api/early/markets`,
  `/api/conditions` (no caller in the app).
- **Old styling**: `--vg-*` CSS variables (now aliases of the cat palette), `.vg-ticket`, Tailwind
  classes on older pages next to inline token styles on newer ones. Proposal: tokens as CSS
  variables named `--hc-*`, one approach (inline tokens via `C`/`F` or CSS classes), not both.
- **Unused dependency candidates**: `@openzeppelin/merkle-tree` (drops only), `qrcode` (keep: share
  links), `server-only` (keep).

## 9. Names and wording

- **Leftover product names**: "Verdict" appears in about 40 files (package `@verdict/relay`,
  contract names, page titles, README), "guarantee" in about 65, "early payout" in about 38,
  "pounce" in 8, "drops" in about 19, "integration" in about 35.
- **Proposed scheme**:
  - Product "HonorCat"; packages `@honorcat/relay`, `@honorcat/web`.
  - Contract `HonorCatPots` (name decided in D0).
  - Routes under `/pots/...`, `/me`, `/honor/...`; API under `/api/pots/...`, `/api/catalog/...`.
  - Contract events in PascalCase (`PotCreated`, `SideJoined`, `ExitRequested`, `PotDivided`,
    `Handshake`, `Takeover`, `PotSettled`, `PotExpired`).
  - Database tables and columns in snake_case; TypeScript in camelCase.
  - Components PascalCase.tsx, modules camelCase.ts.
- **Wording**: pot, side, share, exit, land. No bet, wager or win. "Not financial advice" and the
  testnet banner on every page.
- **The local folder is named `verdict`**; the GitHub repository is already `honorcat`. Renaming the
  local folder is up to you.

## 10. Order of work in C1 (after approval)

1. Tag `pre-cleanup`, create branch `cleanup`.
2. Archive docs; replace rubric; rewrite README.
3. Remove unused code (WalletButton, DeviceWallet, /api/early/markets, old picker).
4. Remove the guarantee and drops products (pages, API, relay modules, tests, components) while the
   relay keeps settling any open vault/guarantee/early pots.
5. Move retired contracts, scripts and tests to `contracts/archive`; CI updated.
6. Remove the v1 integration API, webhooks and the SDK.
7. Renames (packages, env vars after Vercel is updated, CSS tokens); one Gemini client; one
   WebSocket reader.
8. Tests green after each step; deploy and smoke-test production after the removals.

## Questions for you

1. **Open pots on the old contracts**: the relay must keep settling them until none remains. If you
   prefer, I can stop creating new early-payout pots right away in C1 and leave the settlement path
   until they are done.
2. **Old tables**: keep them read-only (my proposal), or may I drop them after the last pot settles?
3. **Renaming the old `pots` table to `vault_pots`**: OK?
4. **The SDK**: remove now and rebuild in D5 (my proposal), or keep it until then?
5. **Env var renames** (RESOLVER_PRIVATE_KEY → RELAY_PRIVATE_KEY, EARLY_* → SAMPLERS/RESOLVER_ADDRESS):
   these need the same change in Vercel and GitHub. I can make the code accept both names during
   the switch; OK?
