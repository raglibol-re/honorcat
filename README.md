# Verdict

Conditional USDC payouts on Circle's **Arc testnet**. USDC is locked in a pot and is paid out to
payees (by share) or refunded once an authorised resolver signs the outcome of an external event.
Verdict is infrastructure: an app decides what a condition means, Verdict holds the money, signs,
settles, indexes and notifies.

**Verdict Guarantees** is the product built on it: a business promises customers a refund if a
real-world event happens ("if it is hotter than 95°F on your tour day, you get your money back"),
priced from live Gemini markets, with the refunds locked on Arc, customers joining without a
wallet, and payment the moment the market settles. See [Verdict Guarantees](#verdict-guarantees).

> Testnet only. Never use these keys or contracts on mainnet.

**Live:** https://verdict-phi-livid.vercel.app ([status](https://verdict-phi-livid.vercel.app/status),
[developers](https://verdict-phi-livid.vercel.app/developers)) · vault
[`0xba7190441bc00fC1AC8597d68197039e1167E6D4`](https://explorer.testnet.arc.io/address/0xba7190441bc00fC1AC8597d68197039e1167E6D4)
on Arc testnet (chainId 5042002). The scripted e2e run passes against this deployment in every
mode (classic, gasless, integration API, multisig resolver, guarantees) for both outcomes.

```
contracts/   Foundry (Arc Foundry): VerdictVault, GuaranteeBook, BatchGuard, MultisigResolver,
             unit/fuzz/invariant tests, deploy scripts
relay/       TypeScript library: sources, signer, resolver, indexers, gasless relaying,
             integrations, webhooks, gas accounting, read models, e2e script
web/         Next.js app on Vercel: UI + every HTTP API route (the relay runs inside it)
sdk/         @verdict/sdk: typed client, gasless signing helpers, webhook verification
deployments/ <chainId>.json written by the deploy script (vault address, deploy block)
```

## What you can build on it today

| You want to… | Use |
|---|---|
| Hold a payment until your backend says "done" (delivery, milestone, match result) | API key → `POST /api/v1/conditions {source:"api"}` → gasless pot → `POST /api/v1/outcomes` |
| Let a payer fund without gas, approve or an Arc-configured wallet | `POST /api/gasless/prepare` → user signs once → `POST /api/gasless/create` / `fund` |
| Settle on a public data feed without writing code | source `http`: `{"url","path","yes","no"}` |
| Settle on a prediction market | source `gemini`: `EVENT:CONTRACT` |
| Not trust a single key for the outcome | deploy a `MultisigResolver` (M-of-N, ERC-1271) and use it as the pot's resolver |
| React in your backend | signed webhooks: `pot.created`, `pot.funded`, `pot.resolved`, `pot.expired`, `payment.*` |
| Show money movements | `/ledger`, `/pots/:id`, or `GET /api/payments` |
| Watch costs and health | `/status` (resolver balance, gas spent in USDC, runway, indexer lag) |

Quickstart with curl is on [`/developers`](https://verdict-phi-livid.vercel.app/developers); with TypeScript:

```ts
import { Verdict, verifyWebhook } from "@verdict/sdk";
const verdict = new Verdict({ baseUrl: "https://verdict-phi-livid.vercel.app", apiKey: process.env.VERDICT_KEY });
const { conditionId } = await verdict.registerCondition({ source: "api", key: "order-1042", label: "Order 1042 delivered" });
const { potId } = await verdict.createPotGasless({
  signer: payerAccount,                     // any viem account / wallet client; it only signs
  amount: 5_000_000n,                       // 5 USDC (6 decimals)
  params: { conditionId, payees: [seller], sharesBps: [10_000], refundTo: payer, deadline: Math.floor(Date.now() / 1000) + 86_400 },
});
await verdict.reportOutcome(conditionId, true); // final; changing it later returns 409
const settled = await verdict.waitForSettlement(potId!);
```

API keys are issued by the operator: `POST /api/admin/integrations {name, webhookUrl}` with
`Authorization: Bearer $ADMIN_TOKEN` (the key and webhook secret are returned once).

## Verdict Guarantees

Two roles. The **merchant** creates and funds a guarantee; the **customer** joins and gets paid.
Live: [`/guarantees`](https://verdict-phi-livid.vercel.app/guarantees),
[`/guarantees/new`](https://verdict-phi-livid.vercel.app/guarantees/new), customer page `/g/<id>`,
public proof `/g/<id>/proof`.

| Template | Gemini markets (read live, never hardcoded) | Enrolment closes |
|---|---|---|
| Rate | Fed decision events (`FED…`, category Economics) | 24 h before the decision |
| Temperature | daily high by city (`WXHIGH-…`), only for days that have not started | 24 h before expiry (≈ start of the measured day) |
| Price | crypto daily and commodity threshold contracts (`strike.type` above/below) | 6 h before the close |
| Demo | 5- and 15-minute crypto up/down (`…05M…`, `…15M…`), labelled as a demo | 75 s before expiry |

The promise is rendered in one sentence from the API fields (`title`, contract `label`,
`strike.value`, `expiryDate`), verified against developer.gemini.com. A guarantee can refund on
the contract settling Yes or on it settling No (condition key `EVENT:CONTRACT[:no]`). The chance
shown is the market price (bid/ask midpoint, else last trade) and is labelled an estimate; the
expected cost is chance × refunds; the worst case is what the merchant locks. The hedge (contracts
and price) is information only; Verdict never places orders.

**On-chain shape (the vault is unchanged).** A guarantee is a vault pot whose only payee is the
`GuaranteeBook` contract and whose `refundTo` is the merchant, plus a book entry (refund per
customer, seats, lock time). It is created in **one transaction** through Arc's Multicall3From,
all-or-nothing: `BatchGuard.expectNextPotId` → `Memo.memo(vault, createPotWithAuthorization(…))`
(the merchant only signs an EIP-3009 authorization for every seat) → `GuaranteeBook.open`.
Customers join by signing a message; the relay enrols them (gas paid by the relay). When Gemini
settles, the relay sends **one transaction**: `Memo.memo(vault, resolve(…))` and, if triggered,
`Memo.memo(book, payout(…))`, so the verdict and every customer refund land together with the
reason in the memo. Unused seats go back to the merchant; not triggered or expired, the vault
refunds the merchant. Customers withdraw with a signed USDC `transferWithAuthorization` the relay
submits, so they never need gas.

**Customer accounts.** Passkey accounts are not built yet. The temporary path is a key generated in
the browser and kept in its storage (`DeviceWallet`, behind the same `WalletAdapter` interface), so
it can be swapped for passkeys without changing the pages. Clearing site data loses the key; the
UI says so and suggests withdrawing.

**Trust.** The relay is the GuaranteeBook operator: it enrols customers and is trusted not to enrol
fake ones (a Merkle-root mode can replace the list). The resolver key decides outcomes from Gemini's
public API. Everything else (locked amount, enrolments, payouts) is on-chain and shown on the proof page.

**Tested on production** (`e2e --mode guarantees`): on a live BTC 5-minute market, a refund-on-Yes
and a refund-on-No guarantee, three customers each. Gemini settled Yes: the three customers received
exactly 0.10 USDC each (none of them sent a transaction), the merchant got the other 0.30 USDC back,
resolution and refunds were in the same transaction (1.6 s from result to payment), memos carried
the reason, and a customer withdrew without gas. Rate, temperature and price guarantees were created,
funded and filled on live markets; they settle when Gemini settles those markets.

| Measured on Arc testnet | Gas | USDC |
|---|---|---|
| create guarantee (guard + memo'd createPotWithAuthorization + open) | 478k | 0.0096 |
| enrol one customer | 126k | 0.0025 |
| settle two pots + refund three customers + three memos, one tx | 361k | 0.0072 |
| gasless withdraw (memo'd transferWithAuthorization) | 137k | 0.0028 |

## Architecture

```
            ┌──────────── Vercel (web/) ──────────────────────────────────────────┐
 browser ──▶│ pages: /create /pots/[id] /ledger /status /developers               │
 your app ─▶│ API: public  GET /api/pots, /api/pots/:id, /api/payments, /api/status│
            │      v1      /api/v1/{me,conditions,outcomes,pots,deliveries,…} (key)│
            │      gasless POST /api/gasless/{prepare,create,fund}                 │
            │      admin   /api/admin/{outcome,integrations} (bearer)              │
            │      hooks   POST /api/webhooks/quicknode (HMAC), GET /api/cron/tick │
            │                     │ runTick(): lease-guarded, rate-limited         │
            │                     ▼                                                │
            │  @verdict/relay                                                      │
            │   RPC poller ┐                      sources: api manual gemini http  │
            │   Streams    ├─▶ chain_events ─▶ pots ─▶ resolver (EIP-712) ─┐       │
            │   receipts ──┘        │                                      ▼       │
            │                       └─▶ webhook outbox ─▶ HMAC POST   sendVaultTx  │
            │                                            (backoff)    (fee floor,  │
            │                                                          gas in USDC)│
            └──────────────────────────┬────────────────────────────────┬──────────┘
                                       │ Postgres (Neon)                │ Arc testnet
```

There is no long-running process. A relay **tick** (index new logs, deliver webhooks, ask each
source for outcomes, sign and submit `resolve`, expire overdue pots) runs whenever something calls
the API:

| Trigger | When | Notes |
|---|---|---|
| API reads (`/api/pots*`, `/api/payments`, `/api/status`, `/api/v1/*`) | every 2–5 s while a page is open or an integration polls | via `after()`, rate-limited by `TICK_MIN_INTERVAL_MS`, guarded by a DB lease |
| Writes (`/api/v1/outcomes`, gasless, admin outcome) | immediately | the write itself nudges the relay |
| QuickNode Streams webhook | every delivered batch (seconds) | the recommended filter always returns an object, so each batch acts as a clock |
| Vercel Cron `/api/cron/tick` | Hobby: **once per day** (±59 min); Pro: up to every minute | daily safety net only on the free plan |

**Trade-off (free Hobby plan):** Vercel Cron Jobs run at most once a day, and the newer
Schedules feature (beta) at most every 15 minutes with a 15-minute jitter. Settlement therefore
depends on traffic: an open page, an integration call, the e2e script, or a QuickNode Stream.
Reporting an outcome through the API triggers a tick itself, so the common path settles in
seconds. On Vercel Pro, change the cron schedule to `* * * * *`.

## Built for Arc

Every place where Verdict deliberately handles an Arc difference. Facts checked against
docs.arc.io (EVM differences, contract addresses, execution layer, transaction memos, batched
transactions) and the live testnet RPC:

| Arc property | How Verdict uses it |
|---|---|
| Chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`, faucet `https://faucet.circle.com` | config enforces chain 5042002; testnet only |
| **USDC is the gas token**, one balance exposed twice: native (18 decimals) and ERC-20 at `0x3600…0000` (6 decimals) | all amounts use the ERC-20 interface; every relay receipt's `gasUsed × effectiveGasPrice` (18 dp) is stored and converted to 6-dp USDC (`/ 10¹²`, rounded up). `/status` reads the resolver balance through both interfaces and shows they agree |
| **USDC is FiatToken v2**: EIP-2612 + **EIP-3009** (`receiveWithAuthorization`); EIP-712 domain name `USDC`, version `2` (verified: `DOMAIN_SEPARATOR()` matches) | gasless funding: the payer signs, the relay submits `fundWithAuthorization` / `createPotWithAuthorization`. The relay reads name/version on-chain and checks them against `DOMAIN_SEPARATOR()` before building typed data |
| Base fee floor **20 gwei**; underpriced transactions are dropped silently | every relay transaction sets `maxFeePerGas ≥ 20 gwei × 1.125 + tip` |
| **Deterministic sub-second finality**, no reorgs | the indexer reads `latest` with zero confirmations; one receipt is final. Receipt polling runs every 500 ms (viem's 4 s default made relay latency ~4.2 s; now ~0.7–1.3 s, measured in `relay_txs.latency_ms`) |
| `eth_getLogs` ≤ 10,000 blocks per call | the poller uses 5,000-block chunks |
| **Native USDC transfers log from a system address** (`0xffff…fffE`, 18 dp) in addition to the ERC-20 `Transfer` (6 dp) | the indexer only reads logs from the vault, the GuaranteeBook and the Memo contract, so it never double-counts; contracts emit their own events for every state change and payment |
| **Blocklist**: a value transfer to or from a blocklisted address reverts | payouts and refunds use `trySafeTransfer`; a failed transfer becomes `claimable` with `PaymentDeferred` / `RefundDeferred` instead of blocking the pot (vault and GuaranteeBook); fuzz/invariant tests toggle the blocklist |
| **No on-chain randomness** (`PREVRANDAO` is always 0) | nothing in Verdict uses randomness on-chain; pot ids are sequential, EIP-3009 salts and nonces are made off-chain |
| **Memo** `0x5294…E505` routes a call through CallFrom and logs `BeforeMemo` / `Memo` | funding, resolution, refunds and withdrawals carry a memo: bytes32 reference + JSON reason. Memos are indexed and tied to the events between `BeforeMemo` and `Memo` |
| **Multicall3From** `0x522f…47D0`: batched calls with the EOA as `msg.sender`, no value forwarding | guarantee creation is one atomic batch; settlement of everything due is one batch (failing calls are dropped after simulation). Pot ids are predicted, so `BatchGuard.expectNextPotId` makes the batch revert instead of funding another pot. Verdict never forwards value |
| CallFrom extensions **do not accept smart-contract wallets** as the caller | the relay and the customers' device accounts are EOAs; a future passkey (contract) account must call through the relay instead |

Measured on testnet (from `/api/status`): resolve ≈ 110k–160k gas ≈ 0.0023–0.0033 USDC (refund vs. two payouts); gasless
create + fund ≈ 330k gas ≈ 0.0067 USDC; gasless top-up ≈ 109k gas ≈ 0.0022 USDC.

### Batching on Arc: measured

`relay/scripts/bench-batch.ts` on Arc testnet, median of 3 runs, 0.01 USDC pots paying one payee.
Time is from the first send to the last receipt (Arc finality is one receipt).

| Operation | Txs | Gas | Fee (USDC) | Time to final |
|---|---|---|---|---|
| create + fund: approve, createPot, fund | 3 | 334,821 | 0.0077 | 4.75 s |
| create + fund: one Multicall3From batch (with BatchGuard) | 1 | 289,862 | 0.0068 | 1.50 s |
| settle 1 pot: resolve | 1 | 108,666 | 0.0026 | 1.47 s |
| settle 1 pot: batch | 1 | 119,243 | 0.0028 | 1.05 s |
| settle 1 pot: batch, memo | 1 | 136,584 | 0.0032 | 1.48 s |
| settle 5 pots: 5 resolve txs | 5 | 543,330 | 0.0111 | 10.85 s |
| settle 5 pots: one batch | 1 | 417,317 | 0.0086 | 1.56 s |
| settle 5 pots: one batch, memo per pot | 1 | 474,716 | 0.0097 | 1.56 s |
| settle 10 pots: 10 resolve txs | 10 | 1,086,636 | 0.0222 | 17.54 s |
| settle 10 pots: one batch | 1 | 790,005 | 0.0158 | 1.45 s |
| settle 10 pots: one batch, memo per pot | 1 | 901,756 | 0.0180 | 1.47 s |

Batching saves the 21k base cost per transaction (27% gas at 10 pots) and, more importantly,
turns N sequential confirmations into one: settlement time stays ~1.5 s regardless of N. A memo
costs ~11k gas per pot. For a single pot the batch wrapper costs ~10% more than a direct call, so
the relay sends a lone call directly and batches only when two or more are due.

## Contracts

### `VerdictVault`

- `createPot(conditionId, resolver, payees[], sharesBps[], refundTo, deadline)`: shares sum to 10,000.
- `fund(potId, amount)`: anyone, repeatedly, until the deadline (needs USDC `approve`).
- `fundWithAuthorization(potId, amount, auth)`: same, from an EIP-3009 authorization signed by
  `auth.from`; anyone may submit. The 3009 nonce must equal
  `fundNonce(potId, salt) = keccak256(abi.encode("VerdictVault.fund" tag, chainId, vault, potId, salt))`.
- `createPotWithAuthorization(params, amount, auth)`: create + fund in one transaction; `auth.from`
  becomes the creator. The nonce is `createNonce(params, salt)`, which commits to **every** pot
  parameter (condition, resolver, payees, shares, refundTo, deadline).
  Because the nonce is derived on-chain and `receiveWithAuthorization` requires `msg.sender == to`,
  a submitter can neither redirect a signature to another pot, change the amount or terms, nor
  front-run it at the token level. Replays fail on the token's used-nonce check.
- `resolve(potId, outcome, signature)`: EIP-712 `Resolution(uint256 potId,bytes32 conditionId,bool outcome)`
  signed by the pot's resolver (EOA or **ERC-1271**). Domain: name `VerdictVault`, version `1`,
  chainId, verifyingContract. Anyone may submit. Allowed until `deadline + gracePeriod`; unfunded
  pots revert.
- `expire(potId)`: after `deadline + gracePeriod`, refunds the whole pot to `refundTo`.
- `claim()`: if a transfer failed (e.g. a USDC-blocklisted recipient), the amount is credited as
  claimable instead of blocking the pot; the recipient withdraws it later.

Rounding: each payee gets `floor(total * bps / 10000)`; the last payee gets the remainder, so no dust
remains. **Refunds go to `refundTo` as a whole; third-party funders are not refunded individually**
(per-funder refunds are a possible later extension). No owner, no upgradeability.

Events: `PotCreated`, `PotFunded` (incl. funder), `PotResolved`, `PotExpired`, `Payout`, `Refund`,
`PaymentDeferred`, `Claimed`.

### `MultisigResolver`

Immutable M-of-N ERC-1271 signer. Use its address as a pot's `resolver`; the vault verifies it
through OpenZeppelin `SignatureChecker`. Signature = `threshold` 65-byte ECDSA signatures over the
resolution digest, concatenated in strictly increasing signer-address order (rejects duplicates
without storage). Exercised on testnet by the e2e `multisig` mode (1 of 3 rejected, 2 of 3 settle).

## Relay

- **Sources** (`ResultSource { getOutcome(conditionId) → true | false | null }`; `null` never acts):

  | Source | Key | Outcome |
  |---|---|---|
  | `api` | any string, **owned** by the registering integration | reported by the owner via `POST /api/v1/outcomes`; immutable once reported |
  | `manual` | any string | `POST /api/admin/outcome` with `ADMIN_TOKEN` (demos, tests) |
  | `gemini` | `<eventTicker>:<contractTicker>` | contract `status == "settled"` and `resolutionSide` yes/no (public `GET /v1/prediction-markets/events/{ticker}`) |
  | `http` | JSON `{"url","path","yes","no"}`, canonicalised | value at `path` deep-equals `yes` / `no`; https only, no redirects, 5 s timeout, 256 KB cap, private/loopback/metadata IPs refused |

  `conditionId = keccak256("<source>:<key>")`; registration is idempotent and validates the key
  with the source (and fills the label) when the source supports it.
- **Transactions** all go through `sendVaultTx`: simulate (reverts cost nothing) → Arc fee floor →
  send → receipt → ingest the receipt's logs immediately → record gas paid in USDC in `relay_txs`.
- **Gasless relaying** (`/api/gasless/*`): the relay verifies the signature off-chain, checks the
  payer's balance, a minimum amount (`GASLESS_MIN_AMOUNT`) and a per-payer hourly limit
  (`GASLESS_MAX_PER_HOUR`; API-key callers exempt), and without an API key only sponsors pots it
  resolves itself.
- **Integrations**: API keys `vk_<id>_<secret>` (SHA-256 stored, constant-time compare, revocable).
- **Webhooks**: a transactional outbox filled in the same pass that ingests an event; delivered on
  ticks with `Verdict-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` and
  `Verdict-Event-Id` (dedupe key), exponential backoff (10 s … 1 h, 12 attempts), at-least-once.
- **Indexing**: all vault logs go into `chain_events` (idempotent on `(tx_hash, log_index)`); `pots`
  is rebuilt per pot from its events; `payments` is a view. Sources: RPC poller, Streams webhook,
  and the relay's own receipts. When `VAULT_ADDRESS` changes, vault-scoped tables are cleared and
  re-indexed from `VAULT_DEPLOY_BLOCK` (conditions, outcomes and integrations are kept).
- `INDEXER_PRIMARY=rpc|streams` switches whether ticks poll RPC logs.

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
cd contracts && arc-forge test --network arc     # 80 tests: unit, fuzz, 9 invariants, GuaranteeBook (WSL)
pnpm --filter @verdict/relay test                # 31 relay tests (GEMINI_LIVE=1 adds a live check)
pnpm --filter @verdict/sdk test                  # SDK tests
```

### 4. Fund the testnet wallets

Get testnet USDC from https://faucet.circle.com (Arc Testnet) for the deployer (gas and pot funds)
and the resolver (gas for `resolve` / `expire` and sponsored gasless transactions).

### 5. Deploy the contract (WSL)

```bash
./contracts/deploy.sh      # writes deployments/5042002.json (vault, deployBlock)
```

Then update `VAULT_ADDRESS` / `VAULT_DEPLOY_BLOCK` in `.env` and on Vercel and redeploy; the relay
re-indexes the new vault automatically.

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

### 7. End-to-end runs (definition of done)

```bash
pnpm --filter @verdict/relay e2e -- --api https://verdict-phi-livid.vercel.app --mode all --outcome both
```

| Mode | What it proves on Arc testnet |
|---|---|
| `classic` | approve → create → fund from a wallet; operator reports; relay pays out / refunds |
| `gasless` | a fresh payer that never sends a transaction (nonce stays 0) creates and tops up a pot by signature; Arc USDC marks the 3009 nonce used; a replay is rejected |
| `api` | an integration registers an owned `api` condition, funds gaslessly, reports the outcome itself; 401 without a key, 403 for another integration, 409 on flipping. `--webhook <url>` also checks delivery |
| `multisig` | deploys a 2-of-3 `MultisigResolver`; one owner signature is rejected on-chain, two settle the pot |

Every mode checks recipient balances on-chain, the payments in `/api/payments` (what `/ledger`
shows), the relay's gas per pot, and prints the relay's balance and runway. The script reads
`DEPLOYER_PRIVATE_KEY` and `ADMIN_TOKEN` from `.env`; `ADMIN_TOKEN` must match the server's.

## Deploying to Vercel

The whole app (UI and relay API) deploys from `web/` with Vercel's Git integration: every push to
`main` updates production, every other branch gets a preview deployment. The live project is
`raglibol/verdict` (Root Directory `web`, Neon Postgres in us-east-1).

To set it up from scratch:

1. Push this repo to GitHub.
2. Vercel dashboard → **Add New… → Project → Import** the repository.
3. **Root Directory: `web`**. Framework: Next.js (auto-detected). Keep the default build and install
   commands; Vercel detects the pnpm workspace from the root `pnpm-lock.yaml`.
4. **Storage → Neon (Marketplace) → Create / Connect**, or set `DATABASE_URL` to any Postgres
   (pooled connection string). The schema is created automatically on first request.
5. Add the environment variables below (Production and Preview), then **Deploy**.
6. Check `https://<project>.vercel.app/api/health` and `/status`, then run the e2e script against it.

CLI alternative:

```bash
npm i -g vercel@latest
vercel login
vercel link                      # in the repo root; select the project
vercel env add ADMIN_TOKEN       # repeat for each variable (add --sensitive for secrets)
vercel deploy --prod
```

Preview deployments share the production database and resolver key unless you give Preview its own
`DATABASE_URL` (e.g. a Neon branch). The DB lease makes that safe, but only one environment should
run the resolver for a given vault in normal operation.

### Environment variables

Nothing secret uses the `NEXT_PUBLIC_` prefix. Private keys and tokens are set **only** in the host's
environment settings (or the git-ignored `.env`), never committed.

| Variable | Where | Secret | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Vercel | **yes** | Postgres (Neon) |
| `RESOLVER_PRIVATE_KEY` | Vercel | **yes** | signs outcomes; submits `resolve` / `expire` and sponsored gasless transactions |
| `ADMIN_TOKEN` | Vercel + local `.env` | **yes** | bearer for `/api/admin/*` (outcomes, integrations) |
| `CRON_SECRET` | Vercel | **yes** | bearer Vercel Cron sends to `/api/cron/tick` |
| `QUICKNODE_STREAMS_TOKEN` | Vercel | **yes** | Streams security token (webhook HMAC) |
| `VAULT_ADDRESS` | Vercel | no | deployed vault (from `deployments/5042002.json`) |
| `VAULT_DEPLOY_BLOCK` | Vercel | no | first block the poller scans |
| `ARC_RPC_URL` | Vercel, local | no | default `https://rpc.testnet.arc.io` |
| `INDEXER_PRIMARY` | Vercel | no | `rpc` (default) or `streams` |
| `TICK_MIN_INTERVAL_MS` | Vercel | no | default `4000` |
| `GASLESS_MIN_AMOUNT` | Vercel | no | smallest sponsored amount in USDC, default `0.10` |
| `GASLESS_MAX_PER_HOUR` | Vercel | no | sponsored transactions per payer per hour without API key, default `10` |
| `RELAY_LOW_BALANCE_USDC` | Vercel | no | `/status` warns below this resolver balance, default `1` |
| `GEMINI_API_BASE` | Vercel | no | default `https://api.gemini.com` |
| `NEXT_PUBLIC_RPC_URL` | Vercel | no | optional browser RPC override |
| `DEPLOYER_PRIVATE_KEY` | local `.env` only | **yes** | deploys contracts, funds the e2e runs |
| `USDC_ADDRESS`, `GRACE_PERIOD_SECONDS` | local `.env` | no | deploy script inputs |

The browser gets the vault and resolver addresses from `/api/health`, so no contract address is
baked into the frontend build.

## QuickNode Streams (optional, recommended on the free Vercel plan)

1. Create a Stream: chain **Arc**, network **Testnet**, dataset **Logs**.
2. Filter: paste `STREAMS_FILTER_TEMPLATE` from `relay/src/indexer/quicknode.ts` with the vault and
   GuaranteeBook addresses (lowercase), or upload it with
   `tsx --env-file=../.env relay/scripts/quicknode-stream.ts --filter --status active`
   (needs `QUICKNODE_API_KEY`, `QUICKNODE_STREAM_ID`). It returns `null` (QuickNode skips the
   delivery) unless a block holds our events or is a heartbeat block (every 20th, ~10 s), so a plan
   capped at 1 block per delivery stays at ~0.1 webhook calls/s, inside Vercel Hobby's included
   invocations. The heartbeat keeps waking the relay to settle results that arrive off-chain.
3. Destination: Webhook `https://<project>.vercel.app/api/webhooks/quicknode`, compression none or
   gzip. Copy the stream's security token into `QUICKNODE_STREAMS_TOKEN` and redeploy.
4. Optionally set `INDEXER_PRIMARY=streams` to stop polling logs over RPC on each tick.

The webhook verifies `X-QN-Signature = hex(HMAC-SHA256(token, nonce + timestamp + body))` and accepts
both nesting depths of the logs dataset as well as receipts payloads.
