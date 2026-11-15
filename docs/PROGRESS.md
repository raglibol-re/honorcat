# Progress

## Done
- Phases A, B, G (Merkle payouts, e2e `drops` passing on production), HonorCat guarantees, market picker.
- Early payouts (docs/early-payout-spec.md): Gemini data checked, plan written, all seven open points
  decided 2026-11-15 (sampler hosting rules and budget, evidence binding, provisional parameters,
  terms edge cases, no historical crossing stat, kept/dropped additions, priorities).
- **M1 trigger engine** (`relay/src/trigger/`, docs/early-payout-trigger.md): integer-only rule
  (valid samples, time-weighted midpoint, minimum samples, fresh data at window end), parameters
  committed in the conditionId, canonical evidence records and hash, signer attestations, 2-of-3
  aggregation with evidenceRoot. 30 tests incl. replays of recorded Gemini feeds; full suite green
  (contracts 108, relay 68 + 1 skipped, SDK 4, web typecheck and lint).

## Decisions 2026-11-15 (late)
- Deployer funded by the user (20.18 test USDC).
- Samplers: free option (the Vercel app, GitHub Actions, one local machine); no paid hosting.
- Markets: the product is market-generic (any active Gemini contract); parameters follow the market's
  horizon; the demo uses whichever live contract best meets the trigger rules. "As long as the tool works."
- Work in cycles per docs/improve.md, everything in the agreed priority order.

## Rubric cycle log
- 2026-11-15: third browser review done (47e66ab): honest featured payout ("No crossing caught yet"
  until a crossing exists), earlier-payout label with market, rail values from records, stamp clear
  of the threshold, Guarantees out of the footer, animated hero number. Wallets from other chains
  (05d0e6b): pay from six CCTP testnets, join and My money with any EVM wallet; passkey stays default.
- 2026-11-15: HonorCat redesign to docs/design approved by the user and shipped (merge 0a33a55):
  landing, recipient-card pot page, /early/new, /live, /status, /account, /how; shared tokens and
  chrome on every other page. No radius/shadow/gradient anywhere (checked on production, 12 routes,
  desktop and phone).
- 2026-11-15: second browser review, five items added to docs/rubric.md and done (40e2a3a): /live
  status bug (API, not QuickNode), landing replay + steps, two demo choices, precomputed demo
  candidates (0.2 s), readable charts and page-language dates. Banner keeps "Not insurance".
- 2026-11-15: user feedback "too much text": consumer pages cut to one headline, one sentence and one
  button each (phone word counts: landing 54, create 50, join 52, account 15); the long explanation moved
  to /how, per-pot rules into a collapsed "Full rules", internals behind "Show technical details".
  Header: Start / How it works / My money. Checked on production at phone width: no overflow, no console
  errors (commits 27a9ad6, b09fd39).
- 2026-11-15 (night): early payouts M2-M4 built and deployed (samplers resolver 0x81d1...36c9,
  sampler on Vercel/GitHub Actions/local, funder flow, live view, recipient card, proof page,
  post-settlement record, landing). e2e `early` passed twice in a row on production (02:01-02:15
  UTC). CI with Slither gate (24/24 explained), threat model, demo script, Devpost draft, README.
  Attempts that failed and why: thin book flipping one-sided (finder now watches books), demo template
  following market horizon (demo rule forced), app sampler gaps (270 s Streams bursts).
- 2026-11-15 audit of production (15 routes, desktop and phone): clean except `/g/<unknown>` console
  404s. Fixed (8f2acb6), re-audited clean. Secrets check added (`scripts/check-secrets.mjs`): no
  secret values in git history or the production bundle. BACKLOG.md and docs/rubric-evidence.md created.

## In progress
- Rubric goal (docs/rubric.md), working by docs/improve.md. Evidence in docs/rubric-evidence.md,
  candidates in BACKLOG.md. 18 of 19 items checked.

## Next
- M2 funder flow and live view, M3 recipient flow, evidence on the proof page, post-settlement record,
  M4 e2e on the demo template.
- Then: phase I threat model and static analysis, minimal phase H, phase E only if time allows.

## Blocks current milestone
- Rubric item "A new user completes the recipient flow on a phone without help" needs a real person
  on a real phone. Automated stand-in passed (phone emulation + virtual passkey, joined in 5.5 s).
  Please hand a phone to someone who has not seen HonorCat, open
  https://verdict-phi-livid.vercel.app/e/G25xt3gjrG (listed, open to join until ~04:15 UTC) or a new
  pot, and note whether they joined without help.

## Later
- GitHub Actions sampler needs the repository secret `SAMPLER_KEY_GITHUB` (setting it from here
  was refused by the permission check). Until then two samplers (Vercel, local machine) carry the
  2-of-3; if this machine's sampler stops, pots cannot trigger and refund only at the deadline.
- The post-settlement outcome record (memo on a read-only vault call) is implemented but has not run
  yet: the first early payouts' markets settle on 2026-11-15/16.
- Samplers (needed for M2): three independent always-on workers on at least two providers, budget
  $25 until 2026-11-22. Exact cost per host and login/card steps go to the user before anything paid
  is created. Data source: Gemini `@depth5` (snapshot every second), not `@bookTicker` (quiet books
  would look stale).
- Feasibility of the provisional parameters, from live books on 2026-11-15:
  - Non-demo values are usually met: weather books 2-5c spread with 100-200 contracts per side;
    Fed 5-6c (at the limit); Nasdaq 4c; commodities 1-7c. A real Austin weather feed passed every
    rule (it stayed below 85% only because the market was at 81.5%).
  - Demo values are essentially never met on 5-minute crypto markets: 11-98c spreads and 2-5
    contracts at the best price. M4 needs the demo template to trigger, so the demo template needs
    a different market or looser demo values before M4.
- Minimum size per side: decided 10 (demo) / 50 (others); revisit once samplers run.
