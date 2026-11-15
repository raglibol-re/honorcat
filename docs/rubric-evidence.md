# Rubric evidence

One section per item of docs/rubric.md. An item is checked only with evidence here.
Production: https://verdict-phi-livid.vercel.app

## Works end to end

### [ ] Scripted run passes against production twice in a row: one early payout, one refund
Not yet: the early-payout e2e mode (BACKLOG #13) does not exist yet. Existing modes (classic,
gasless, api, multisig, guarantees, passkey, drops) passed on production earlier; see README.
2026-11-15 regression run after 8f2acb6 (`--mode all --outcome no`): classic refund passed (pot
#182); gasless stopped because the deployer wallet ran out of test USDC (0.18 USDC left; each run
sends refunds to fresh addresses). Blocked on a faucet top-up, see docs/PROGRESS.md.

### [ ] A new user completes the recipient flow on a phone without help
Not yet (needs the early-payout recipient flow, BACKLOG #12, and a human test).

### [ ] No console errors and no failed requests on any page
Audit 2026-11-15 (puppeteer, desktop 1280 px and phone 390 px, 15 routes incl. two unknown ids):
no console errors, no failed requests, no horizontal overflow on every existing page, except
`/g/<unknown id>`, which logged two 404s (BACKLOG #1).
Fixed in 8f2acb6 (server-side not-found for unknown guarantee ids). Re-audit on production after
deploy: `/g/doesnotexist`, `/g/doesnotexist/proof`, `/d/doesnotexist`, `/g/TMS98ihdbH`,
`/g/TMS98ihdbH/proof`: 0 console errors, 0 failed requests at both widths; they show "This page
does not exist". (An unknown top-level route such as `/nothing-here` correctly answers HTTP 404.)
Still unchecked: pages of the early-payout flow do not exist yet.

### [ ] Every page handles loading, empty and error states
Partly: see BACKLOG #8.

## Clear in the first minute

### [ ] Landing states what HonorCat does in one sentence and shows one live example
### [ ] A first-time visitor can start the demo template in under 60 seconds (click path recorded)
### [ ] No unexplained jargon outside "Under the hood"

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
### [ ] README explains setup, architecture and every Arc-specific choice

## Sponsor fit

### [ ] Gemini: the trigger uses live Gemini market data; the proof page shows contract and samples
### [ ] Arc: USDC gas, signature-only funding, batched payout, measured confirmation times visible and documented
### [ ] QuickNode: the live view shows events delivered by Streams, and the stream is running
2026-11-15 `GET /api/streams`: configured, 4 blocks behind head, 22 batches in the last 5 minutes,
p50 delivery latency 1,356 ms. The live view (`/live`) renders Streams batches.

## Honest and safe

### [x] Testnet banner and "not insurance" note on every page
Audit 2026-11-15: banner text ("Test version … Not insurance; no real hedge is placed.") present on
all 15 routes at both widths (`banner=true` in the audit report).

### [ ] Terms screen matches actual behaviour for every edge case
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

### [ ] Demo script for a three-minute video
### [ ] Devpost project description draft
