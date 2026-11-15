# Verdict

Conditional USDC payouts on Circle's **Arc testnet**. USDC is locked in a pot and is paid out to
payees (by share) or refunded once an authorised resolver signs the outcome of an external event.
Verdict is infrastructure: an app decides what a condition means, Verdict holds the money, signs,
settles, indexes and notifies.

**HonorCat** ("Promises that always land.") is the product built on it, shown to merchants and
customers as "HonorCat, settled by Verdict": a business promises customers a refund if a
real-world event happens ("if it is hotter than 95°F on your tour day, you get your money back"),
priced from live Gemini markets, with the refunds locked on Arc, customers joining without a
wallet, and payment the moment the market settles. See [HonorCat](#honorcat-the-product). Verdict
remains the name of the engine: contracts, SDK, API and developer docs.

**HonorCat's main flow: early payouts** ("Paid before it happens."). Money is paid out the moment a
Gemini market considers an event very likely, before it happens; three independent samplers decide
from Gemini's public order book and a 2-of-3 resolver releases the money; afterwards HonorCat records
whether the market was right. See [Early payouts](#early-payouts-the-main-product), the spec in
[docs/early-payout-spec.md](docs/early-payout-spec.md) and the rule in
[docs/early-payout-trigger.md](docs/early-payout-trigger.md).

> Testnet only. Never use these keys or contracts on mainnet.

**Live:** https://verdict-phi-livid.vercel.app ([status](https://verdict-phi-livid.vercel.app/status),
[developers](https://verdict-phi-livid.vercel.app/developers)) · vault
[`0xba7190441bc00fC1AC8597d68197039e1167E6D4`](https://explorer.testnet.arc.io/address/0xba7190441bc00fC1AC8597d68197039e1167E6D4)
on Arc testnet (chainId 5042002). The scripted e2e run has passed against this deployment in every
mode (classic, gasless, integration API, multisig resolver, guarantees, passkey accounts, Merkle
payouts to 250 payees).

```
contracts/   Foundry (Arc Foundry): VerdictVault, GuaranteeBook, MerkleBook, BatchGuard,
             MultisigResolver, PasskeyAccount(+Factory), unit/fuzz/invariant tests, deploy scripts
relay/       TypeScript library: sources, signer, resolver, indexers, gasless relaying, drops,
             passkeys, early-payout trigger engine (src/trigger), integrations, webhooks,
             gas accounting, read models, e2e script
web/         Next.js app on Vercel: UI + every HTTP API route (the relay runs inside it)
sdk/         @verdict/sdk: typed client, gasless signing helpers, webhook verification
deployments/ <chainId>*.json written by the deploy scripts (addresses, deploy blocks)
docs/        early-payout spec and trigger rule, PROGRESS.md, submission rubric and its evidence
scripts/     check-secrets.mjs: secret values vs git history and the production bundle
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

## HonorCat: the product

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

**Accounts and wallets.** Most people use a passkey: joining creates a `PasskeyAccount` on Arc and
the relay pays gas. Crypto users can skip the passkey: they join with any EVM wallet (one plain
signature, on whatever chain the wallet is on) and payouts land in that address on Arc. Funders
pay from Arc or from USDC on Base Sepolia, Ethereum Sepolia, Arbitrum Sepolia, OP Sepolia, Avalanche
Fuji, Polygon Amoy or Solana Devnet (Phantom/Solflare; the Solana wallet controls an Arc account derived
from one signature, `web/src/lib/solana.ts`): the wallet burns it there with Circle CCTP V2 (Fast Transfer), Circle attests
the burn, `/api/cctp/receive` submits the attestation on Arc (relay pays the gas, only USDC burns
addressed to Arc are accepted) and the same address receives the USDC, ready for the one-signature
funding (`web/src/lib/cctp.ts`, `components/cat/BridgeIn.tsx`).

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

## Early payouts (the main product)

**Paid before it happens.** A funder picks any live Gemini contract, a side and a probability
threshold (85% by default), and sets USDC aside for up to 50 people. People join with a passkey.
When the market's smoothed probability holds above the threshold, everyone is paid at once; after
the market settles, HonorCat records publicly whether the event happened ("Confirmed", "Market was
wrong" or "Market voided"). An early payout is final. If the threshold is never reached, the funder
gets the money back at trading close (early-only), or people are paid at settlement if the event
happened (early-or-outcome). No vault change.

**Short words on the screen, details one click away.** The consumer pages show one sentence and one
button each; everything else lives on [`/how`](https://verdict-phi-livid.vercel.app/how), in a
collapsed "Full rules" block, on the proof page, or behind "Show technical details" in the footer
(which brings back hashes, the rule parameters, the samplers' signatures and the technical pages).

| Page | What it is |
|---|---|
| [`/`](https://verdict-phi-livid.vercel.app) | "Get paid before it happens.", one sentence, "Try it", and a real live payout card with its chart |
| [`/early/new`](https://verdict-phi-livid.vercel.app/early/new) | funder flow: Quick demo with two labelled choices, "Instant" (already above the threshold) and "Watch it cross" (just below it), answered at once from candidates the server precomputes from the Streams webhook, or pick any Gemini event from a picture picker, the outcome and how likely (slider with the live chance and recent trade prices), name, amount, people; one signature, then a share link and QR code. "More options": refund vs pay-if-it-happens, minutes to join |
| `/e/<id>` | recipient page: a short headline ("Paid when “X” hits 85%") with the event below, "You get", "Chance now", "Ends in", a three-step bar (Money in / Watching / Paid), one "Join" button (passkey), the chance chart, "Full rules" (every edge case in plain words); "Under the hood" in technical mode |
| `/e/<id>/proof` | every sampler's samples and signatures, recomputed in the browser with the same engine; the evidence root vs the payout memo |
| [`/how`](https://verdict-phi-livid.vercel.app/how) | the long explanation for people who want it: how it works, the rule, edge cases, how to check it, test-money note |
| [`/account`](https://verdict-phi-livid.vercel.app/account) | "My money": balance, sign in with the passkey, withdraw everything |

The header shows only Start, How it works and My money; Guarantees, Ledger, Live, Status and
Developers are in the footer (and in the header in technical mode).

**How a payout is decided.** Rule and evidence format: [docs/early-payout-trigger.md](docs/early-payout-trigger.md).

- Three independent **samplers** (keys on the Vercel app, GitHub Actions and a local machine) each
  read Gemini's public order book, apply the rule to their own samples and sign only what their own
  data shows. A sample counts only with a bounded spread, a minimum size on both sides and fresh
  data; the time-weighted midpoint must hold at or above the threshold over a full window. A raw
  tick never triggers. Before watching a pot, a sampler recomputes the conditionId from the
  parameters and checks the pot on-chain.
- The pot's resolver is a **2-of-3 `MultisigResolver`** (`deployments/5042002.samplers.json`) owned
  by the three samplers. The relay accepts a submission only after checking it in full and settles
  once two agree: `resolve` + `GuaranteeBook.payout` in one memo'd transaction whose memo carries
  the **evidence root**. Each sampler's integer-only evidence record and signed `TriggerAttestation`
  are public. The vault does not verify evidence; it makes each decision auditable.
- The trigger parameters, the contract, the side and the pot mode are committed in the pot's
  **conditionId**, so the rule cannot change after creation.
- After trading closes the relay watches Gemini's settlement and records the outcome as an Arc memo.

**Samplers in practice.** Gemini's `{symbol}@depth5` WebSocket sends a full top-of-book snapshot
every second, so quiet books stay fresh (bookTicker only sends changes). Vercel functions cannot
sample every two seconds, so the app's sampler polls the REST book in 270-second bursts run by the
QuickNode Streams webhook (`maxDuration` 300, a database lease keeps one burst at a time, samples
persist between bursts). The others are long-running processes:

```bash
pnpm --filter @verdict/relay sampler -- --api https://verdict-phi-livid.vercel.app --key-env SAMPLER_KEY_LOCAL
```

`.github/workflows/sampler.yml` runs the GitHub sampler every 15 minutes while pots are armed (it
exits within seconds when none are, to stay inside the free Actions minutes); it needs the repository
secret `SAMPLER_KEY_GITHUB`.

**Parameters (provisional).** Markets closing within two hours, and the demo template: 60 s window,
a sample every 2 s, at least 25 valid samples, spread at most 0.04, at least 10 contracts per side,
data at most 10 s old. Others: 30 min, 10 s, 150, 0.05, 50, 60 s. Threshold 85%. Real 5-minute
crypto books rarely meet the demo rule (11-98 cent spreads seen), so the demo finder watches
candidate books over the WebSocket for 12 s and only offers contracts where 90% of snapshots pass.

**Verified on production** (e2e mode `early`, twice in a row, one early payout and one refund each,
3 recipients each): paid early 1.6 and 2.9 minutes after creation, money moved 4.3 s after the second
independent check; evidence roots recompute; refunds at trading close. Details:
[docs/rubric-evidence.md](docs/rubric-evidence.md).

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
| **P-256 precompile** (`0x…0100`, EIP-7951) | passkey accounts verify WebAuthn signatures on-chain (OpenZeppelin `WebAuthn`/`P256`, which uses the precompile); recipients join and withdraw with Face ID / a fingerprint, the relay deploys the account and pays gas |
| ERC-1271 accepted by the vault's `SignatureChecker` | early-payout pots use a 2-of-3 `MultisigResolver` owned by three independent samplers: no single key, including the relay's, can release money |
| Memo carries a reason | the early-payout memo carries the evidence root of the samplers' records, so the on-chain payment points at its public evidence; the post-settlement outcome is a memo on a read-only `getPot` call linked to the pot |

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

### `MerkleBook`: one pot, thousands of payees

A pot whose only payee is the `MerkleBook` and whose `refundTo` is the funder. The book stores a
Merkle root over `(index, account, amount)` (OpenZeppelin standard double-hashed leaves); the list
itself stays off-chain and every proof is public (`GET /api/drops/{id}/proof?account=…`).

- `open(potId, lockTime, claimDeadline, root, rootTotal)` and `setRoot(dropId, root, rootTotal)`:
  funder or operator, only while the pot is open and before `lockTime` (which must be before the
  pot's deadline). Every change emits `RootSet` with an increasing version; then the root is final.
- `claim(dropId, index, account, amount, proof)`: anyone may submit after a positive result; the
  money always goes to `account`. A bitmap blocks double claims. Claims can never exceed the
  root's declared total nor the pot, so a bad tree cannot drain the book.
- Negative result or expiry: the vault refunds the funder directly, as for any pot.
- `sweep(dropId)` after `claimDeadline` (set after the last possible resolution) returns what was
  not claimed to the funder. A blocklisted payee's claim is deferred (`ClaimDeferred`) and
  withdrawn later with `withdrawDeferred()`; it never blocks other payees.
- The relay pushes the claims in batches of 120 through Multicall3From, so payees never act.
  The funder's EIP-3009 signature commits to the list: its salt is `keccak256(root ++ entropy)`.

Gas per payee (`MerkleBookTest.test_gasReport`, Foundry; push model = `GuaranteeBook.payout`):

| Model | Payees | Proof length | Gas per payee |
|---|---|---|---|
| Merkle claim | 10 | 4 | ~57,000 |
| Merkle claim | 1,000 | 10 | ~59,000 |
| Merkle claim | 10,000 | 14 | ~86,000 (cold bitmap words) |
| Push (`GuaranteeBook`) | 50 (its cap) | none | ~30,600, plus ~50,000 to enrol each payee on-chain beforehand |

The push model is cheaper per payout but stores every payee on-chain first and is capped at 50 per
pot; the Merkle model stores 32 bytes for any number of payees and pays ~1 KB of calldata per
claim.

Measured on Arc testnet by the e2e `drops` run (250 payees, proof length 8, relay batches of 120
through Multicall3From): **~73,600 gas per payee** including calldata and batching, three
transactions for all 250 payees, about 0.0015 USDC per payee at Arc's 20 gwei base fee floor.

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
cd contracts && arc-forge test --network arc     # 108 tests: unit, fuzz, 9 invariants, GuaranteeBook, passkeys, MerkleBook (WSL)
pnpm --filter @verdict/relay test                # 75 relay tests incl. trigger replays, samplers and streams (GEMINI_LIVE=1 adds a live check)
pnpm --filter @verdict/sdk test                  # 4 SDK tests
node scripts/check-secrets.mjs . https://verdict-phi-livid.vercel.app   # no secret values in git history or the production bundle
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push plus **Slither**; the build fails
on any finding not explained in `contracts/slither-triage.json` (24 of 24 explained). Threat model:
[docs/threat-model.md](docs/threat-model.md).


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
| `guarantees` | HonorCat guarantees on live Gemini markets: refund-on-YES and refund-on-NO on one 5-minute market, customers refunded in the resolution transaction, gasless withdrawal |
| `passkey` | software passkey registers, joins, and withdraws: the relay deploys the account and WebAuthn is verified on Arc |
| `early` | early payouts on the live contracts best suited right now: one pot pays early (2 of 3 samplers sign; evidence recomputed; evidence root matches the memo), one refunds at trading close; 3 recipients each; on-chain balances. `E2E_EARLY_RUNS=2` repeats it, `E2E_EXTERNAL_LOCAL_SAMPLER=1` uses an already running local sampler |
| `drops` | two drops of 250 payees on one live 5-minute market; list replaced before lock (root v2); a list the funder did not sign is refused; the relay pushes every claim in batches; all payee balances and the funder's return checked on-chain |

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
| `GUARANTEE_BOOK_ADDRESS`, `BATCH_GUARD_ADDRESS`, `GUARANTEES_DEPLOY_BLOCK` | Vercel | no | GuaranteeBook and BatchGuard (`deployments/5042002.guarantees.json`) |
| `MERKLE_BOOK_ADDRESS` | Vercel | no | MerkleBook (`deployments/5042002.merkle.json`) |
| `EARLY_RESOLVER_ADDRESS`, `EARLY_SAMPLERS` | Vercel | no | the samplers' 2-of-3 resolver and the three sampler addresses (`deployments/5042002.samplers.json`) |
| `SAMPLER_KEY` | Vercel | **yes** | the app's own sampler key |
| `SAMPLER_KEY_LOCAL`, `SAMPLER_KEY_GITHUB`, `SAMPLER_KEY_VERCEL` | local `.env`; `SAMPLER_KEY_GITHUB` as a GitHub Actions secret | **yes** | the three sampler keys (deploy script reads their addresses) |
| `PASSKEY_FACTORY_ADDRESS` | Vercel | no | PasskeyAccountFactory (`deployments/5042002.passkeys.json`) |
| `QUICKNODE_API_KEY`, `QUICKNODE_STREAM_ID` | local `.env` | **yes** (key) | `relay/scripts/quicknode-stream.ts` (batch size, filter, status) |
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
