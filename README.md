# HonorCat

**A pot between two sides on a Gemini prediction market, settled in USDC on Arc.** One side takes
YES, the other NO. Each side's share follows the market price, and either side may leave at any time
at a fair, forward-priced value. If nobody leaves, Gemini's settlement decides and the side that was right receives
the pot. Fully collateralised, no leverage, no operator access to funds. Testnet only, not financial
advice.

Live: **https://honorcat.vercel.app** (the earlier address https://verdict-phi-livid.vercel.app
serves the same deployment; passkey accounts created there stay bound to it).

## Status (2026-11-16)

All milestones of the two-sided pot are built and running on Arc testnet: C0 inventory, C1 cleanup,
D0 design (`docs/pot-design.md`), D1 contract, D2 relay, D3 cat and rope view, D4 partial exit,
nine lives, handshake, takeover, D5 honor record, how-it-is-built, terms and proof per pot, the
fair-value reader and end-to-end runs against production. Open items are listed in
`docs/PROGRESS.md` and checked one by one in `docs/rubric.md`.

| Page | What |
|---|---|
| [`/`](https://honorcat.vercel.app) | One live pot on the rope (or an example on a liquid market) |
| [`/pots/new`](https://honorcat.vercel.app/pots/new) | Start a pot: market, side, size (cap from the order book), band, grace |
| [`/pots`](https://honorcat.vercel.app/pots) | Your pots and open offers to join |
| `/pots/<id>` | The rope view (shares in dollars, the cat at the 30-second price, nets and bowls, the exit countdown and stamp), every action for your role, every measured window with each sampler's average |
| `/pots/<id>/tv`, `/terms`, `/proof` | Big-screen view; the pot's terms with its own numbers; contract, rule, evidence hashes |
| `/record/<address>` | Honor record: pots played, held to the end, exits (own, net, bowl), handshakes, takeovers, results |
| [`/how-it-is-built`](https://honorcat.vercel.app/how-it-is-built) | Arc, Gemini and QuickNode: what each does, how to check it, live evidence |
| [`/markets`](https://honorcat.vercel.app/markets), [`/live`](https://honorcat.vercel.app/live), [`/status`](https://honorcat.vercel.app/status) | Market quality from the order book; Streams deliveries; relay health |
| `/how`, `/developers`, `/account` | How it works; contracts and API; your account (passkey or wallet, funding from other chains) |
| `/e/<id>`, `/g/<id>`, `/ledger` | Retired products, read-only |

End-to-end runs (`relay/scripts/pots-e2e.ts --scenario …`, against production, testnet USDC):

| Scenario | Pot | Result |
|---|---|---|
| exit | 3 | joined at 76.5% (median of three), exit priced by the median of three, divided on-chain |
| takeover | 4 | YES asked to leave; a third wallet took its place at the exit price; pot stays live |
| handshake | 5 | both signed 70%; divided at once, no fee |
| bowl | 6 | YES set a bowl below the price; the samplers saw it hold and filed the exit; divided |
| hold | 7 | held to the end on a BTC 15-minute market; waiting for Gemini's result (closes 09:30 UTC) |
| quote | 2 | `pots-quote.ts`: a signed quote valued both sides on-chain through HonorCatFairValue |

## Architecture

```
                    Gemini public API                          QuickNode Streams
          (events list, order book REST + WebSocket,          (Arc blocks, filtered to
           settlement status)                                   our contracts)
                 |               |                                    | signed webhook
                 v               v                                    v
  samplers x3 ----------->  web (Next.js on Vercel)  <------  /api/webhooks/quicknode
  (Vercel, GitHub Actions,   pages + API routes                       |
   local machine): read the        |  uses                            |
   book, sign evidence             v                                  v
   (EIP-712, 2 of 3)       relay library (@honorcat/relay) ----> Neon Postgres
                           catalogue, trigger engine,             (indexed events, catalogue,
                           indexer, settlement, gasless           evidence, relay state)
                                   |
                                   | one send path (Multicall3From), memos (Memo)
                                   v
                           Arc testnet (USDC as gas, chain 5042002)
                           MultisigResolver, PasskeyAccount(+Factory), retired contracts
                                   ^
                                   | Circle CCTP V2 (six EVM testnets, Solana Devnet)
                             funding from other chains
```

- **web/**: Next.js 16 app (pages, API routes, the relay running inside Vercel functions).
- **relay/**: the shared library: Gemini order-book reader (`gemini.ts`), market catalogue
  (`catalog.ts`), trigger engine and evidence format (`trigger/`), samplers, indexer (Streams
  primary, RPC fallback, receipts), settlement of the retired contracts, passkeys, gasless, Arc
  specifics (`arc.ts`, `memo.ts`, `txs.ts`), database (`db.ts`).
- **contracts/**: Solidity (Foundry). Active: `MultisigResolver`, `PasskeyAccount`,
  `PasskeyAccountFactory`. Retired sources in `contracts/archive/`.
- **docs/**: progress and decisions (`PROGRESS.md`), market quality, price and evidence format,
  threat model, cleanup plan, design references; old specs in `docs/archive/`.

## Contracts on Arc testnet (chain 5042002)

Active:

| Contract | Address | Purpose |
|---|---|---|
| **HonorCatPots** | `0xc890C990048f45cb268d076E4A3dB25270Ea1e59` | The two-sided pot (D1): create, forward-priced join and exit, partial exit, handshake, nets and bowls, takeover, settle, expire; positions as ERC-721 (`HCSIDE`) |
| **HonorCatFairValue** | `0x8a890a0A79371333dEaAF1aFC76D68ffDc7671a5` | Stateless reader: a side's value from a signed QUOTE window (kind 6, never accepted by the pot) |
| MultisigResolver | `0x81d1194069E1aD3a22C17356065d8dF6A4D436c9` | 2-of-3 ERC-1271 signer set of the three samplers; signs every price, depth and outcome attestation |
| PasskeyAccountFactory | `0xB93e6C63815Af25213c43dEc1B494452c8ED0ea2` | Deploys passkey (WebAuthn P-256) accounts |
| PasskeyAccount (implementation) | `0xCe60d5aF6F912f0565092A139FEF1bC764b32c65` | |
| Arc USDC (system) | `0x3600000000000000000000000000000000000000` | The only asset, also gas |

Retired (deployed, cannot be removed; on-chain names kept; the relay keeps settling their open pots,
the last deadline is 2026-12-14 05:00 UTC):

| Contract | Address | What it was for |
|---|---|---|
| VerdictVault | `0xba7190441bc00fC1AC8597d68197039e1167E6D4` | One-sided conditional pots, EIP-712 / ERC-1271 resolution, gasless funding (EIP-3009) |
| GuaranteeBook | `0x2C59F2973F67e5Adf1aC4eDCfEF7F6D800746774` | Refund guarantees and the early-payout recipient lists on top of vault pots |
| BatchGuard | `0xf040cb9bc88539E567A0552b082a011c21208AEE` | Atomic batches for guarantees |
| MerkleBook | `0x308b6b2e24C3676824aC64226883F8295d9E867e` | Merkle-root payouts to thousands of payees ("drops") |

Deployment records: `deployments/5042002*.json`. An earlier HonorCatPots deployment at
`0xfd5B783CF1cADD687c90D99B4b2FEb0123F3758a` was a throwaway (replaced the same day after the Slither
review added two admin events; never used).

## Setup

Requirements: Node 22+, pnpm 10, Foundry (for contracts).

```bash
pnpm install
cp .env.example .env          # fill in; secrets only in env vars, never in the repo
```

## Run

```bash
pnpm web dev                                   # the app on http://localhost:3000
pnpm --filter @honorcat/relay sampler -- --api https://honorcat.vercel.app --key-env SAMPLER_KEY_LOCAL
```

Without `DATABASE_URL` the relay uses an embedded PGlite database in `.data/`.

## Test

```bash
cd contracts && forge test                     # resolver and passkey accounts
pnpm --filter @honorcat/relay test             # catalogue, trigger engine, samplers, indexer, migrations
pnpm --filter @honorcat/relay typecheck
cd web && npx tsc --noEmit && npx eslint src && npx next build
```

CI (`.github/workflows/ci.yml`) runs all of these plus Slither on the contracts.

## Deploy

- **Web and relay**: Vercel builds `main` (project root `web/`). Environment variables are set in
  Vercel; the QuickNode Stream posts to `/api/webhooks/quicknode`.
- **Samplers**: one runs inside the app, one in GitHub Actions (`sampler.yml`, needs the repository
  secret `SAMPLER_KEY_GITHUB`), one on a local machine.
- **Contracts**: `forge script script/<Deploy…>.s.sol --rpc-url $ARC_RPC_URL --broadcast`; records go
  to `deployments/`.

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `ARC_RPC_URL`, `ARC_CHAIN_ID`, `USDC_ADDRESS` | Vercel, local | Arc testnet access |
| `DATABASE_URL` | Vercel, local (optional) | Neon Postgres; empty = PGlite |
| `RELAY_PRIVATE_KEY` | Vercel, local | The relay's sending key |
| `RESOLVER_ADDRESS`, `SAMPLERS` | Vercel | The samplers' resolver and addresses |
| `SAMPLER_KEY` / `SAMPLER_KEY_LOCAL` / `SAMPLER_KEY_GITHUB` | Vercel / local / GitHub secret | Each sampler's own key |
| `ADMIN_TOKEN`, `CRON_SECRET` | Vercel | Admin and cron auth; evidence session keys derive from them |
| `INDEXER_PRIMARY`, `QUICKNODE_STREAMS_TOKEN`, `QUICKNODE_API_KEY`, `QUICKNODE_STREAM_ID` | Vercel / local | Indexer source, webhook verification, stream management |
| `PASSKEY_FACTORY_ADDRESS`, `GASLESS_*`, `RELAY_LOW_BALANCE_USDC`, `TICK_MIN_INTERVAL_MS` | Vercel | |
| `VAULT_ADDRESS`, `VAULT_DEPLOY_BLOCK`, `GUARANTEE_BOOK_ADDRESS`, `BATCH_GUARD_ADDRESS`, `GUARANTEES_DEPLOY_BLOCK`, `MERKLE_BOOK_ADDRESS` | Vercel | Retired contracts, needed until their last pot settles |
| `DEPLOYER_PRIVATE_KEY` | local only | Contract deployments |

## Data and honesty

- Prices are Gemini market data. Pages show "Data provided by Gemini" with a link; raw order-book
  readings are shown only to the parties of a pot after sign-in (Gemini's Market Data Agreement
  restricts redistribution). Public pages show evidence hashes and computed values.
- Markets can be wrong. Testnet only, test money only, not financial advice.

## Build log

Built from 2026-11-13 to 2026-11-16 (115 commits; `git log` for every step).

- **2026-11-13**: monorepo; VerdictVault with EIP-712 resolution and a claimable fallback, tests;
  Arc deploy script; Next.js shell on Vercel.
- **2026-11-14**: relay (result sources, signer, resolver, indexers), API routes, first end-to-end
  run; vault deployed on Arc; gasless funding (EIP-3009) and the ERC-1271 multisig resolver; the
  QuickNode Streams pipeline and live view; GuaranteeBook (refund guarantees) with Arc memos and
  batched settlement through Multicall3From.
- **2026-11-15**: HonorCat brand; passkey accounts (WebAuthn/P-256) deployed; MerkleBook drops; the
  early-payout trigger engine with three independent samplers and 2-of-3 signing; the HonorCat
  design system on every page; cross-chain funding with Circle CCTP (six EVM testnets, Solana
  Devnet); the market catalogue of every Gemini contract with quality checks; raw evidence only for
  the parties.
- **2026-11-16**: new direction (two-sided pots); cleanup C1: retired products stop taking new
  pots, retired contracts archived, the SDK and the integrator API removed, one Gemini order-book
  reader, migration of the retired vault table to `vault_pots`, one name (HonorCat), new address
  honorcat.vercel.app.
- **2026-11-16 (later)**: D0 design and D1 contract (HonorCatPots, 84 contract tests with stateful
  invariants, Slither reviewed); D2 relay (window requests, each sampler's signed average, median of
  three or mean of two within half a point, co-signatures, depth and outcome attestations, nets and
  bowls, passkey and wallet actions with HonorCat paying gas, pot events from Streams with RPC
  fallback); D3/D4 pages (start, pot with the rope view, big screen, pots, terms, proof, every action);
  D5 honor record, how-it-is-built, HonorCatFairValue and quotes; end-to-end runs for exit, takeover,
  handshake, bowl, hold and quote against production.
