# Verdict

Conditional USDC payouts on Circle's **Arc testnet**. USDC is locked in a pot and is paid out to
payees (by share) or refunded once an authorised resolver signs the outcome of an external event.

> Testnet only. Never use these keys or contracts on mainnet.

**Live:** https://verdict-phi-livid.vercel.app · vault
[`0xba7190441bc00fC1AC8597d68197039e1167E6D4`](https://explorer.testnet.arc.io/address/0xba7190441bc00fC1AC8597d68197039e1167E6D4)
on Arc testnet (chainId 5042002). The scripted e2e run passes against this deployment for both
outcomes (payout and refund).

```
contracts/   Foundry (Arc Foundry): VerdictVault.sol, tests, deploy script
relay/       TypeScript library: result sources, signer, resolver, indexers, read models, e2e script
web/         Next.js app on Vercel: UI (create, pot status, ledger) + the relay's HTTP API routes
deployments/ <chainId>.json written by the deploy script (vault address, deploy block)
```

## Architecture

```
            ┌──────────── Vercel (web/) ─────────────────────────────────────┐
 browser ──▶│ pages: /create  /pots/[id]  /ledger                            │
            │ API:   GET /api/pots, /api/pots/:id, /api/payments, /api/health│
            │        POST /api/conditions, /api/admin/outcome (bearer)       │
            │        POST /api/webhooks/quicknode (HMAC)                      │
            │        GET  /api/cron/tick (bearer, Vercel Cron)               │
            │                    │ runTick(): lease-guarded, rate-limited     │
            │                    ▼                                            │
            │  @verdict/relay: RPC log poller ─┐   ResultSource (manual, …)   │
            │                  Streams ingest ─┼─▶ chain_events ─▶ pots       │
            │                  receipts ───────┘   resolver: sign + resolve() │
            └────────────────────┬───────────────────────────┬───────────────┘
                                 │ Postgres (Neon)           │ Arc testnet RPC
```

There is no long-running process. A relay **tick** (index new logs, ask each source for
outcomes, sign and submit `resolve`, expire overdue pots) runs whenever something calls the API:

| Trigger | When | Notes |
|---|---|---|
| API reads (`/api/pots*`, `/api/payments`) | every 2–4 s while a page is open or the e2e script runs | via `after()`, rate-limited by `TICK_MIN_INTERVAL_MS`, guarded by a DB lease |
| QuickNode Streams webhook | every delivered batch (seconds) | the recommended filter always returns an object, so each batch acts as a clock |
| Vercel Cron `/api/cron/tick` | Hobby: **once per day** (±59 min); Pro: up to every minute | daily safety net only on the free plan |

**Trade-off (free Hobby plan):** Vercel Cron Jobs run at most once a day, and the newer
Schedules feature (beta) at most every 15 minutes with a 15-minute jitter, which is too slow for
markets that settle in minutes. Settlement therefore depends on traffic: an open page, the e2e
script, or a QuickNode Stream. With none of these, a result is acted on at the next trigger (at
the latest the daily cron). Once QuickNode Streams is set up, the relay advances every few
seconds without any page open. On Vercel Pro, change the cron schedule to `* * * * *`.

## Arc testnet facts (checked against docs.arc.io and the live RPC)

| | |
|---|---|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` (WS: `wss://rpc.testnet.arc.io`) |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| Faucet | `https://faucet.circle.com` → Arc Testnet |

Gas is paid in USDC (the native balance has 18 decimals; all amount math goes through the ERC-20
interface). The minimum base fee is 20 gwei; `eth_getLogs` covers at most 10,000 blocks per call (the poller uses
5,000). Finality is deterministic and comes with inclusion, so there are no reorgs to handle.

## Contract: `VerdictVault`

- `createPot(conditionId, resolver, payees[], sharesBps[], refundTo, deadline)`: shares sum to 10,000.
- `fund(potId, amount)`: anyone, repeatedly, until the deadline (needs USDC `approve`).
- `resolve(potId, outcome, signature)`: EIP-712 `Resolution(uint256 potId,bytes32 conditionId,bool outcome)`
  signed by the pot's resolver (EOA or ERC-1271). Domain: name `VerdictVault`, version `1`, chainId,
  verifyingContract. Anyone may submit. Allowed until `deadline + gracePeriod`; unfunded pots revert.
- `expire(potId)`: after `deadline + gracePeriod`, refunds the whole pot to `refundTo`.
- `claim()`: if a transfer failed (e.g. a USDC-blocklisted recipient), the amount is credited as
  claimable instead of blocking the pot; the recipient withdraws it later.

Rounding: each payee gets `floor(total * bps / 10000)`; the last payee gets the remainder, so no dust
remains. **Refunds go to `refundTo` as a whole; third-party funders are not refunded individually**
(per-funder refunds are a possible later extension). No owner, no upgradeability.

Events: `PotCreated`, `PotFunded` (incl. funder), `PotResolved`, `PotExpired`, `Payout`, `Refund`,
`PaymentDeferred`, `Claimed`.

## Relay

- `ResultSource { getOutcome(conditionId) → true | false | null }`. `null` (unknown, not settled,
  voided) never triggers an on-chain action. Sources are registered in `relay/src/tick.ts`.
- Conditions are registered with `POST /api/conditions {source, key, label}`;
  `conditionId = keccak256("<source>:<key>")`.
- `ManualSource`: outcomes set with `POST /api/admin/outcome {conditionId, outcome}` and
  `Authorization: Bearer $ADMIN_TOKEN`.
- `GeminiSource`: Gemini prediction markets via the public, keyless
  `GET https://api.gemini.com/v1/prediction-markets/events/{eventTicker}`. Key is
  `<eventTicker>:<contractTicker>` (e.g. `SOL05M2611141625:UP`), checked against the API at
  registration. Per contract: `status == "settled"` and `resolutionSide == "yes"` → met,
  `"no"` → not met; anything else (active, closed, under_review, invalid) → `null`, so a market
  that never settles lets the pot expire and refund. Each event is fetched once per tick
  (Gemini allows 120 req/min). `GEMINI_API_BASE` can point at the sandbox host.
- Indexing: all vault logs go into `chain_events` (idempotent on `(tx_hash, log_index)`); `pots` is
  rebuilt per pot from its events; `payments` is a view (payout, refund, deferred, claim).
  Sources: RPC poller, Streams webhook, and the relay's own transaction receipts.
- `INDEXER_PRIMARY=rpc|streams` switches whether ticks poll RPC logs. The webhook is always
  accepted when `QUICKNODE_STREAMS_TOKEN` is set.

## Setup

Prerequisites: Node ≥ 22.5, pnpm 10, and on Windows **WSL (Ubuntu)** for the contracts.

### 1. Arc Foundry (WSL / Linux / macOS)

```bash
V=v0.8.0-4; T=arc-foundry-$V-x86_64-unknown-linux-gnu
curl -fsSLO https://github.com/circlefin/arc-foundry/releases/download/$V/$T.tar.gz
curl -fsSLO https://github.com/circlefin/arc-foundry/releases/download/$V/$T.tar.gz.sha256
sha256sum -c $T.tar.gz.sha256
mkdir x && tar -xzf $T.tar.gz -C x && mkdir -p ~/.local/bin
for b in forge cast anvil; do mv x/$b ~/.local/bin/arc-$b; done
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
arc-forge --version
```

### 2. Clone, install, configure

```bash
git clone --recurse-submodules <repo-url> verdict && cd verdict
pnpm install
cp .env.example .env      # fill in keys and tokens (see "Environment variables")
```

### 3. Tests

```bash
cd contracts && arc-forge test --network arc     # 37 contract tests (WSL)
pnpm --filter @verdict/relay test                # relay unit tests
```

### 4. Fund the testnet wallets

Get testnet USDC from https://faucet.circle.com (Arc Testnet) for the deployer (gas and pot funds)
and the resolver (gas for `resolve` / `expire`).

### 5. Deploy the contract (WSL)

```bash
./contracts/deploy.sh      # writes deployments/5042002.json (vault, deployBlock)
```

### 6. Run the app locally

Create `web/.env.local` with the server variables (`ARC_RPC_URL`, `VAULT_ADDRESS`,
`VAULT_DEPLOY_BLOCK`, `RESOLVER_PRIVATE_KEY`, `ADMIN_TOKEN`, `CRON_SECRET`; leave `DATABASE_URL`
empty for the embedded PGlite database), then:

```bash
pnpm --filter @verdict/web build && pnpm --filter @verdict/web start   # http://localhost:3000
# or: pnpm --filter @verdict/web dev
```

Fully offline variant: run `arc-anvil --network arc --chain-id 5042002` in WSL, deploy with
`--rpc-url http://localhost:8545` using anvil's public test keys, and set
`ARC_RPC_URL=NEXT_PUBLIC_RPC_URL=http://localhost:8545`.

### 7. End-to-end run (definition of done)

```bash
# against a local server
pnpm --filter @verdict/relay e2e -- --api http://localhost:3000 --outcome both
# against the Vercel deployment
pnpm --filter @verdict/relay e2e -- --api https://<project>.vercel.app --outcome both
```

For each outcome the script creates and funds a pot, reports the result via the relay, waits for
the relay to settle on-chain, checks the recipients' USDC balances, and checks the payments in
`/api/payments` (the data the `/ledger` page shows). It reads `DEPLOYER_PRIVATE_KEY` and
`ADMIN_TOKEN` from `.env`; `ADMIN_TOKEN` must match the server's.

## Deploying to Vercel

The whole app (UI and relay API) deploys from `web/` with Vercel's Git integration: every push to
`main` updates production, every other branch gets a preview deployment.

1. Push this repo to GitHub.
2. Vercel dashboard → **Add New… → Project → Import** the repository.
3. **Root Directory: `web`**. Framework: Next.js (auto-detected). Keep the default build and install
   commands; Vercel detects the pnpm workspace from the root `pnpm-lock.yaml`.
4. **Storage → Neon (Marketplace) → Create / Connect** to the project. This sets `DATABASE_URL`.
   The schema is created automatically on first request.
5. Add the environment variables below (Production and Preview), then **Deploy**.
6. Check `https://<project>.vercel.app/api/health`, then run the e2e script against it.

CLI alternative (after the project exists):

```bash
npm i -g vercel@latest
vercel login
vercel link                      # in the repo root; select the project
vercel env add ADMIN_TOKEN       # repeat for each variable
vercel deploy                    # preview;  vercel deploy --prod  for production
```

Preview deployments share the production database and resolver key unless you give Preview its own
`DATABASE_URL` (e.g. a Neon branch). Only one environment should run the resolver for a given vault.

### Environment variables

Nothing secret uses the `NEXT_PUBLIC_` prefix. Private keys and tokens are set **only** in the host's
environment settings (or the git-ignored `.env`), never committed.

| Variable | Where | Secret | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Vercel | **yes** | Postgres (Neon); set by the Marketplace integration |
| `RESOLVER_PRIVATE_KEY` | Vercel | **yes** | signs outcomes, submits `resolve` / `expire` |
| `ADMIN_TOKEN` | Vercel + local `.env` | **yes** | bearer token for `POST /api/admin/outcome` |
| `CRON_SECRET` | Vercel | **yes** | bearer token Vercel Cron sends to `/api/cron/tick` |
| `QUICKNODE_STREAMS_TOKEN` | Vercel | **yes** | Streams security token (webhook HMAC) |
| `VAULT_ADDRESS` | Vercel | no | deployed vault (from `deployments/5042002.json`) |
| `VAULT_DEPLOY_BLOCK` | Vercel | no | first block the poller scans |
| `ARC_RPC_URL` | Vercel, local | no | default `https://rpc.testnet.arc.io` |
| `INDEXER_PRIMARY` | Vercel | no | `rpc` (default) or `streams` |
| `TICK_MIN_INTERVAL_MS` | Vercel | no | default `4000` |
| `NEXT_PUBLIC_RPC_URL` | Vercel | no | optional browser RPC override |
| `DEPLOYER_PRIVATE_KEY` | local `.env` only | **yes** | deploys the vault, funds pots in the e2e script |
| `USDC_ADDRESS`, `GRACE_PERIOD_SECONDS` | local `.env` | no | deploy script inputs |

The browser gets the vault and resolver addresses from `/api/health`, so no contract address is
baked into the frontend build.

## QuickNode Streams (optional, recommended on the free Vercel plan)

1. Create a Stream: chain **Arc**, network **Testnet**, dataset **Logs**.
2. Filter: paste `STREAMS_FILTER_TEMPLATE` from `relay/src/indexer/quicknode.ts` with the vault
   address (lowercase). It returns `{ logs, batchEnd }` for every batch.
3. Destination: Webhook `https://<project>.vercel.app/api/webhooks/quicknode`, compression none or
   gzip. Copy the stream's security token into `QUICKNODE_STREAMS_TOKEN` and redeploy.
4. Optionally set `INDEXER_PRIMARY=streams` to stop polling logs over RPC on each tick.

The webhook verifies `X-QN-Signature = hex(HMAC-SHA256(token, nonce + timestamp + body))` and accepts
both nesting depths of the logs dataset as well as receipts payloads.
