# Rubric evidence

One section per item of docs/rubric.md. An item is checked only with evidence here.
Production: https://verdict-phi-livid.vercel.app

## Works end to end

### [x] Scripted run passes against production twice in a row: one early payout, one refund
`E2E_EARLY_RUNS=2 pnpm --filter @verdict/relay e2e -- --api https://verdict-phi-livid.vercel.app --mode early`
(2026-11-15 02:01–02:15 UTC), live Gemini contracts picked by `/api/early/demo`, 3 recipients each:

```
--- early run 1 of 2 ---
trigger market: ETH price on November 15 — $1,880 or above (NO at 97.0%, spread 0.03)
refund market:  BTC price today at 9:05pm EST — Up (NO at 34.0%), closes 02:05 UTC
PAID EARLY: _8iR830So7 settled early …/tx/0xd102eb55… (1196 min before trading closes)
on-chain: 3 recipients received 0.1 USDC each; none sent a transaction
evidence: 2 signer records recompute; evidenceRoot 0x1a70ec7b2f04… matches the payout memo; signers 0x5342D1, 0x75E233
REFUNDED: VgIyQpo305 settled close …/tx/0xa9cef521…
on-chain: refund-run recipients got nothing; the funder got 0.3 USDC back
--- early run 2 of 2 ---
trigger market: Baylor vs BYU: Point Spread — BYU wins by more than 6.5 points (YES at 96.0%, spread 0.02)
refund market:  BTC price today at 9:15pm EST — Up (NO at 15.0%), closes 02:15 UTC
PAID EARLY: 075q0y7RQ- settled early …/tx/0x22547eaf… (1312 min before trading closes)
on-chain: 3 recipients received 0.1 USDC each; none sent a transaction
evidence: 2 signer records recompute; evidenceRoot 0xd7bdf16d851b… matches the payout memo; signers 0x75E233, 0x5342D1
REFUNDED: AxhE4N4yFz settled close …/tx/0xedf264fe…
on-chain: refund-run recipients got nothing; the funder got 0.3 USDC back
E2E PASSED
```
Pages: /e/_8iR830So7, /e/075q0y7RQ- (paid early), /e/VgIyQpo305, /e/AxhE4N4yFz (refunded).

Re-run on the final code (af9b58b, 2026-11-15 02:46-03:05 UTC), again twice in a row:
run 1 paid early FbGSWDMdui (ZEC $800+, tx 0x5f8c4ff4…) and refunded V8_1nyc7oI at close (pot #208,
0.3 USDC back to the funder); run 2 paid early OZarDwqbIS (BTC $62,000+, tx 0xa479c343…) and refunded
Lb_qsZb0o_ at close (pot #210). Both evidence roots recompute and match the payout memos. `E2E PASSED`.
Earlier attempts and what they fixed: a thin book flipping one-sided (finder now watches books
over WebSocket), the demo template following the market horizon (demo rule now forced), the app
sampler's short bursts (now 270 s bursts from the Streams webhook).

### [ ] A new user completes the recipient flow on a phone without help
Automated stand-in (2026-11-15, production, 390 px phone emulation, virtual platform passkey via
CDP WebAuthn, unlisted pot M3dVXZoVUv): card visible at 2.7 s, "Join with a passkey" tapped, "You
are on the list." at 5.5 s, no console errors. **Still needs a real person on a real phone without
help**; open, see docs/PROGRESS.md.

### [x] No console errors and no failed requests on any page
Production audit 2026-11-15 after the early-payout pages (puppeteer, 1280 px and 390 px, 20 routes:
`/`, `/early/new`, `/e/<paid>`, `/e/<paid>/proof`, `/e/<open>`, `/e/<open>/proof`, `/e/<refunded>`,
`/e/<unknown>`, `/guarantees`, `/guarantees/new`, `/g/<id>`, `/g/<id>/proof`, `/account`, `/live`,
`/status`, `/ledger`, `/developers`, `/pots`, `/pots/199`, `/d/<id>`): **40 of 40 page loads with 0
console errors, 0 failed requests, 0 px horizontal overflow**. Earlier fix: unknown guarantee ids
(8f2acb6).

### [x] Every page handles loading, empty and error states
Every client page has all three (code review 2026-11-15): account, drop check, early payout view
(loading, error, before joining / joined / paid / refunded), funder flow (loading markets, Gemini
unavailable, no market in a category, no demo market, price chart loading / no trades), guarantee
view and proof, guarantee list and form, ledger, live view, pots, pot detail, status. Server pages
render a branded not-found page for unknown ids. Fixed in this cycle: the landing example showed an
endless skeleton if its API failed (4569edf); the price chart said "no trades" while loading
(1b79bb1).

## Clear in the first minute

### [x] Landing states what HonorCat does in one sentence and shows one live example
`/` (c4b3744, 7ccd299): "HonorCat sets money aside for a list of people and pays all of them the
moment a live Gemini market considers an event very likely, before it happens, so they can
prepare." Next to it, a live early payout from this deployment (listed pot G25xt3gjrG, NYC daily
high on a real Gemini contract, open to join) with its live chance, threshold, chart and proof
link; visible 0.8 s after load in the click-path run.

### [x] A first-time visitor can start the demo template in under 60 seconds (click path recorded)
Recorded on production 2026-11-15 (puppeteer, 1280 px):

```
  0.9 s  landing: one sentence and the live example visible
  1.3 s  clicked 'Try the demo' -> /early/new
  1.3 s  clicked 'Use the demo market'
 23.4 s  demo market chosen: BTC price on November 15, "$62,000 or above" happens, at 88% now.
         Its order book meets the demo rules.
 23.4 s  form filled; 'Set aside $0.30 and publish' enabled (next: one wallet signature)
```
Then one wallet signature and the create call (about 5-10 s in the e2e runs): about 35 s in total.
The visitor needs a wallet holding test USDC; recipients need nothing (passkey join in 5.5 s).

### [x] No unexplained jargon outside "Under the hood"
Pass over the consumer pages (2026-11-15): plain words for the rule ("the gap between the best buy
and sell price", "independent checks"); the rail's fixed state names carry a plain note each
("watching the market", "2 of 3 checks agree"); Arc explained on the landing page ("a public
payment network where anyone can see it"). Technical terms (conditionId, resolver, evidence root,
samplers) appear only in "Under the hood", on the proof page and on the developer, ledger and status
pages.

## Technical rigour

### [x] Full test suite green, including the trigger replay tests
CI on every push (`.github/workflows/ci.yml`): contracts (`forge test`: unit, fuzz, invariants),
Slither gate, relay + SDK tests (incl. `test/trigger.test.ts` replaying recorded Gemini feeds and
`test/sampler.test.ts`), web typecheck + lint. Green, e.g. run 43664982700
(https://github.com/raglibol-re/honorcat/actions/runs/43664982700). Locally 2026-11-15: contracts
108, relay 74 + 1 skipped, SDK 4.
2026-11-15 locally: contracts 108 passed (`arc-forge test`), relay 68 passed + 1 skipped
(`pnpm --filter @verdict/relay test`, includes `test/trigger.test.ts` with recorded Gemini feeds),
SDK 4 passed, web `tsc --noEmit` and `eslint src` clean. Not yet in CI (BACKLOG #3).

### [x] Threat model document is current
[docs/threat-model.md](threat-model.md) (2026-11-15): actors, vault/books, the early-payout trigger
(price spikes, thin books, spoofed orders, stale data, voided markets, one or two colluding
samplers, the relay withholding, the app lying about parameters, funder-chosen parameters,
recipient manipulation), keys/relay/app; what stops each threat and what does not.
### [x] Static analysis runs in CI with no unexplained findings
Slither 0.11.3 runs in CI on `contracts/src`; `contracts/slither-gate.py` fails the build on any
finding not explained in `contracts/slither-triage.json`. CI log of run 43664982700:
`24 findings, 24 explained in slither-triage.json` (1 high: `PasskeyAccount.execute` is the
passkey-signed generic call by design; the rest: false positives, trusted-vault reentrancy,
coarse timestamps).
### [x] README explains setup, architecture and every Arc-specific choice
README.md (2026-11-15): Setup (Arc Foundry, install, tests incl. CI and Slither, funding, deploy,
local run, e2e modes incl. `early`), Architecture, "Early payouts (the main product)" (pages,
how a payout is decided, samplers in practice, parameters, production results), "Built for Arc"
table (chain id, USDC gas token, FiatToken v2 / EIP-3009, fee floor, finality, getLogs limit,
system transfer logs, blocklist, no randomness, Memo, Multicall3From, CallFrom limits, P-256
precompile, ERC-1271 2-of-3 resolver, memo evidence root), measured gas and batching tables,
environment variables incl. sampler keys.

## Sponsor fit

### [x] Gemini: the trigger uses live Gemini market data; the proof page shows contract and samples
Samplers read `wss://ws.gemini.com` `{symbol}@depth5` (local, GitHub Actions) or
`https://api.gemini.com/v1/book/{symbol}` (Vercel bursts); market status from
`/v1/prediction-markets/events/{ticker}`. Proof pages of the e2e payouts show the instrument
symbol, side, every sample of each sampler (time, bid, ask, sizes, status), recomputed in the
browser: /e/_8iR830So7/proof, /e/075q0y7RQ-/proof.

### [x] Arc: USDC gas, signature-only funding, batched payout, measured confirmation times visible and documented
Visible: funder flow "You confirm once in your wallet. No approval step and no network fees."
(EIP-3009, one atomic Multicall3From create+fund+open); paid card "Money moved 4.3 seconds after the
second independent check saw the rule met" (/e/075q0y7RQ-); resolution and payout to every
recipient in one memo'd transaction (e2e settlement txs); `/status` shows relay gas spent in USDC
and runway; guarantee cards show result-to-payment time. Documented: README "Built for Arc",
batching benchmark table, MerkleBook gas table (~73.7k gas per payee measured on Arc).

### [x] QuickNode: the live view shows events delivered by Streams, and the stream is running
`/live` renders Streams batches as they arrive. `GET /api/streams` 2026-11-15 02:37 UTC: 23 batches
in the last 5 minutes, p50 delivery latency 1,277 ms, 19 blocks behind head. Streams deliveries also
run the app's own sampler in 270 s bursts (6414334).

## Honest and safe

### [x] Testnet banner and "not insurance" note on every page
Audit 2026-11-15: banner text ("Test version … Not insurance; no real hedge is placed.") present on
all 15 routes at both widths (`banner=true` in the audit report).

### [x] Terms screen matches actual behaviour for every edge case
Terms screen: `/e/<id>` "Terms in plain words". Each case and where the behaviour is enforced or tested:
- rule (spread, size, staleness, window, minimum samples, 2 of 3): `relay/src/trigger/engine.ts`,
  `test/trigger.test.ts` (spike, wide spread, thin size, one-sided, stale, outage);
- parameters fixed at creation: conditionId commitment (test "the conditionId commits to every
  parameter"); samplers ignore pots whose parameters do not match (`sampler.test.ts`);
- early-only, never reached: refund at trading close (samplers sign `close`); e2e refund runs
  VgIyQpo305 and AxhE4N4yFz;
- early-or-outcome: paid at settlement if it happened, else refund; no result: expiry after
  deadline + grace (`sampler.test.ts` "pays at settlement", `processEarly` expiry);
- bad or missing data never pays; an outage until close counts as not reached: engine tests and `close`;
- under review: cannot trigger (`sampler.test.ts`);
- voided before a payout: refund (`sampler.test.ts` "signs void"); after a payout: the payout
  stands and "market voided" is recorded (`recordSettledOutcomes`, 3297048);
- early payout final, "market was wrong" recorded: there is no clawback path in the contracts;
  `recordSettledOutcomes` records `market_wrong`;
- recipient cannot receive: others are paid, the amount stays claimable for them (GuaranteeBook
  deferral, `GuaranteeBook.t.sol` test_payout_blocklistedCustomerIsDeferred).

### [x] No secrets in the repository or the browser bundle
`node scripts/check-secrets.mjs . https://verdict-phi-livid.vercel.app` (2026-11-15) compares every
secret value in `.env` (never printed) with the full git history and every JS chunk production serves:

```
secret values checked: 6 (DEPLOYER_PRIVATE_KEY, RESOLVER_PRIVATE_KEY, ADMIN_TOKEN, CRON_SECRET, QUICKNODE_STREAMS_TOKEN, QUICKNODE_API_KEY)
git history: 1706246 bytes, 212 tracked files, .env tracked: false
git history hits: 0
  env var NAME appears in bundle: QUICKNODE_STREAMS_TOKEN (/_next/static/immutable/chunks/103ny8yvey830.js)
production bundle: 21 JS chunks, 1011342 bytes, secret value hits: 0
```
The one name in the bundle is the `/live` notice "QuickNode Streams is not configured on this
deployment (QUICKNODE_STREAMS_TOKEN)", the variable's name, not its value.

## Submission

### [x] Demo script for a three-minute video
[docs/demo-script.md](demo-script.md): timed shot list and narration, with a fallback.

### [x] Devpost project description draft
[docs/devpost.md](devpost.md).

## Second browser review (2026-11-15, commit 40e2a3a)

### [x] /live shows Streams deliveries, confirmed by a real delivery; neutral status for visitors
Cause of "no deliveries yet": `/api/streams?since=<last seen id>` returned `lastBatch: null` whenever
no newer batch existed, i.e. between every two deliveries (one every ~14 s, polled every 1.5 s). The
stream itself was active (QuickNode API: `status: active`) with no delivery gap over 2 min since
2026-11-14 22:46 UTC (SQL over `stream_batches`). Fix: `lastBatch` is the newest delivery regardless
of `since`; test `relay/test/streams.test.ts` ("reports the last delivery even when a polling client
has already seen every batch"). Real delivery with vault events: batch 13527, 2026-11-15 11:01:27 UTC,
block 72424094, `PotResolved` + `Refund` for pot #20, 1,230 ms after the block. After deploy, headless
Edge on /live: "streaming · last delivery 1.1 s ago", no "no deliveries yet", no "resume" text, no
console errors. The operator hint (QuickNode pauses a stream after failed deliveries; resume in the
dashboard or `scripts/quicknode-stream.ts --status active`) is in a new "QuickNode Streams" card on
/status, shown only when there has been no delivery for over two minutes.

### [x] Landing shows real current data or a labelled replay, plus the three steps
`LiveEarly` shows an open or watched pot live ("Live now"); otherwise `/api/early/replay` (the latest
real early payout with at least 20 valid samples) is played back over 14 s, labelled "Replay of a real
payout" with its date, the chance updating, ending in "Paid early to everyone on the list". The three
"How it works" steps are back below. Screenshots: scratchpad `shots/r2-home-a.png`, `r2-home-b.png`
(replay of OZarDwqbIS: 95% now, pays at 85%, paid marker on the threshold line).

### [x] Quick demo offers Instant and Watch it cross, both labelled
/early/new: "Instant: Already above 85%. Pays about a minute after joining closes." and "Watch it
cross: Just below 85% now. Pays only if it rises; otherwise the money comes back." Watch candidates:
a healthy book over 12 s of WebSocket snapshots (90% valid), observed chance between threshold - 8
points and the threshold. Browser run: "Picked: New England vs Detroit: Player Touchdowns, at 84% now."

### [x] Quick demo picks a market without a 10 to 15 second wait
Candidates are precomputed in `relay_state` (`demo_candidates`), refreshed from the Streams webhook at
most every 90 s under a lease; `/api/early/demo` answers from that cache (`cached: true`): 1.29 s cold,
0.20 s and 0.19 s warm (curl), 483 ms from click to "Picked" in the browser. `?fresh=1` computes live;
the e2e uses it. (Filling the form afterwards still loads the category's markets and the trade chart:
chart visible 8.9 s after the click.)

### [x] Readable price chart with axes and threshold; dates in the page language
Trade chart (create page) and probability chart: 480-unit viewBox (labels about 12-13 px at phone
width), y axis with its range and a bold threshold label, dashed threshold line, three time ticks.
Every date goes through `lib/format.ts` with `PAGE_LOCALE = "en-US"` (matches `<html lang="en">`);
`grep toLocale` finds no call without it. Checked with Edge launched with `--lang=de-DE` and
`Accept-Language: de-DE`: axis "5:05 AM / 10:02 AM / 3:00 PM", replay date "Nov 15, 4:05 AM".
Screenshot `shots/r2-new.png`.

