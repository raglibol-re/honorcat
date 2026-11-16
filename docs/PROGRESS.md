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
- 2026-11-16: polish P8 to P10: cats in the landing's worked example, QR codes on invitations, a
  preview image per pot link, plain messages everywhere, sixteen pages clean at phone width with
  keyboard and axe (relay/scripts/a11y-check.mjs). Open: Streams' share since the stream resumed
  (QuickNode is delivering again, slowly); the poller covers everything meanwhile.
- 2026-11-16: production database replaced. The old Neon project `verdict` hit its free monthly
  quota (data transfer: the catalogue was read whole every 10 s per instance) and refused every query
  until 2026-12-01; by your decision a new free Neon project `honorcat` (spring-glade-62475881) was
  created and rebuilt from public sources (relay/scripts/rebuild-db.ts: catalogue, all 21 pots from
  the chain, markets matched for 20, practice markers). Lost: names, furs, passkey registrations,
  drafts, the retired products' history (the old project stays untouched). The catalogue is now read
  at most every 5 min per instance, refreshed every 2 min, and polled every 60 to 120 s by pages.
  QuickNode had terminated the stream after the failed deliveries; resumed.
- 2026-11-16: polish P4 to P7 done (rope, exit confirmation and summary, handshake button, code of
  honor, "Well played" and rematch, honor labels, cat states); browser run on pot 22: 102.6 s.
- 2026-11-16: polish P2 done: pick your cat (fur and name, signed together) on first sign-in; cats
  beside names in lists, offers, invitations and the honor record; each player's cat on its post
  reacting to its side; name filter with the `obscenity` library. The practice pool is at $4 again
  after the test runs (each new test player gets the $2 welcome); refill by hand from
  faucet.circle.com until Circle's faucet API is unlocked.
- 2026-11-16: polish spec (docs/polish-spec.md) started. P1 done: practice pots kept out of the
  honor record and public numbers; passkey creates now return the pot id (before, the practice cat
  never joined a passkey player's pot and the page fell back to the list); the practice cat is
  checked before a pot is created. Phone-width solo run on production: 102 s (pot 18). The relay
  pool was down to $4.42 (Circle's faucet API still answers 403); $6 moved from the deployer.
- 2026-11-16: Circle depth. (1) The relay sends every pot transaction from a Circle
  developer-controlled wallet (0xf1eb...f569; entity secret only in env, Circle's recovery file
  outside the repository; retired products keep their own key); verified: practice pot 14 joined by
  it, a self-test transaction in 1.6 s. (2) Circle Gateway: deposit on seven chains into one
  balance, move into a HonorCat account on Arc with one signature (Circle's fee estimate,
  attestation, mint by the Circle wallet); verified on Arc through the live endpoints (a $0.40 mint
  in 2.3 s, fee at most $0.004). (3) Vercel use lowered: the app's sampler stays up only for windows
  to measure or co-sign. Next: Circle smart accounts (Modular Wallets) once the Client Key is set.
- 2026-11-16: test money without faucets: $2 welcome on first sign-in for every account, automatic
  top-ups before deposits (limits: $10 per account and $80 in total a day, $3 floor), pool refill
  from Circle's faucet API every 3 hours once CIRCLE_API_KEY is set; when the pool cannot help,
  pages explain it and link Circle's faucet with one-click copy of the address. Verified live
  (welcome, second welcome refused, top-up of the shortfall, no top-up when enough).
- 2026-11-16: browser wallets handled like a serious web3 app: deposits are an exact-amount USDC
  approval plus an ordinary transaction (no more EIP-3009 transfer signatures, which wallet
  scanners flag as drainer-like), exits and takeovers are transactions; EIP-6963 wallet discovery;
  Sign-In with Ethereum for raw readings (checked against the host, ERC-1271/6492 supported);
  HonorCatPots, MedianResolver and HonorCatFairValue verified on the Arc explorer. Verified on testnet with pots-wallet-e2e.ts (pot 12). Markets shown as
  events with Gemini's artwork and a chance bar per result; Gemini's mark in every credit.
- 2026-11-16: pots started together by two friends (user decisions: one against one, starting at the
  market price, no contract change). Shared draft (relay drafts.ts, /api/hc/drafts), pages
  /pots/together and /pots/together/<id>, never listed among open offers. E2E "together" passed on
  production (pot 10).
- 2026-11-16 (improvements): sampler health (heartbeat, /api/health/samplers 503 below 2 of 3,
  notice on pot pages, list on /status); MedianResolver (0x62FB...3c62) computes the price on-chain
  from each sampler's signed average, samplers include Gemini's market status in their own
  validity, new pots use it (pots 8, 9 verified); invite sharing, web-push notifications per pot,
  open offers on the landing, the creator's own entry price, a reliability note per market
  (spread, depth, trades), one approval per passkey account, test USDC for new passkey accounts,
  waiting copy; Streams backfill run recorded (docs/streams-backfill.md); daily e2e workflow.
  Sampler hosting stays as it is (user decision): the Vercel sampler plus two on the local machine.
- 2026-11-16: D3/D4/D5. Pages: start a pot, pot with the rope view, big screen, pots list, terms and
  proof per pot, honor record, how-it-is-built, How it works and Developers rewritten, landing with
  one live pot. Relay: handshake offers, pot_events (Streams primary, RPC fallback, backfilled),
  quotes. Contract: HonorCatFairValue (0x8a89...71a5, 7 tests). Fixes found by the runs: the local
  sampler's two samplers shared one stream (fixed); a window was submitted before Arc's block clock
  passed its end (TooEarly; the relay now waits and retries). E2E against production: exit (pot 3),
  takeover (4), handshake (5), bowl (6), quote (2); pot 7 held to the end and settled YES by Gemini's result (tx 0xc5ecfc86...9dc1), delivered through Streams.
- 2026-11-16: D2 relay done and verified on Arc testnet (pots 1-3). Window requests per join, exit,
  net and bowl; each sampler signs its own window average inside its evidence record; the relay
  proposes the exact median of three (mean of two within 0.5 points, else no price) and submits
  with two co-signatures; depth (cap) and outcome attestations; passkey and wallet (EIP-3009,
  signed exit) actions with HonorCat paying gas; a pots log indexer. Run `relay/scripts/pots-e2e.ts`:
  pot 3 created gaslessly, joined at 76.5% (median of three), exit priced at the median of three,
  divided on-chain (tx 0xbeed0b6b...a498). Pot 1 failed its join correctly (refund, "fewer than two
  valid windows") while the local samplers had a stream bug (fixed: one WebSocket per sampler).
- 2026-11-16: D1 done. HonorCatPots built in the agreed order (core, cap, partial, handshake, nets and
  bowls, takeover), 77 contract tests incl. stateful invariants and symbolic checks, Slither 35/35
  reviewed, deployed on Arc testnet at 0xc890C990048f45cb268d076E4A3dB25270Ea1e59 (an earlier
  throwaway at 0xfd5B…758a, unused). The fair-value reader did not fit under 24 KB: planned as a
  separate stateless contract in D5. The app is unchanged until D3.
- 2026-11-16: D0 design document for the two-sided pot (states, rounding proofs, attestations,
  positions, extras, cap, prices and evidence, tests, threat model, defaults, open decisions).
- 2026-11-16: env vars switched (user asked me to do it): RELAY_PRIVATE_KEY (Production, Preview),
  RESOLVER_ADDRESS and SAMPLERS (Production) set in Vercel with the same values (key piped from the
  local .env, never printed; it derives to the production relay 0x3692…20D6; addresses from
  deployments/5042002.samplers.json, matching production's resolver). Old-name fallbacks removed
  (17e3f94), deployed (dpl_Dg9U9G…, by CLI: the push did not trigger a build), relay checked
  (same address, sampler endpoint 200, tick at 23:58:49 UTC), then the old names deleted in Vercel.
- 2026-11-16: C1 cleanup merged and deployed (0d03952). Open pots on retired contracts listed
  (vault 19, 22, 176, 177 guarantees, last deadline 2026-12-14; 26-31 past deadline, 0.01 each;
  early payouts all settled, one outcome record pending; drops fully claimed). Creation of early
  payouts, guarantees and drops removed; enrolment closed; read-only pages kept. Removed: integrator
  API and webhooks, admin and conditions routes, gasless vault pots, SDK, demo finder, cost view,
  unused components. Retired contracts, tests and deploy scripts in contracts/archive;
  MultisigResolver has its own tests. One Gemini order-book reader (relay/src/gemini.ts); rule
  constants in trigger/params. Migration 001 pots -> vault_pots: 217 rows (10 open) before and after;
  a relay tick on the new deployment read the open pots with no errors. Data truncation on a vault
  change removed (old data stays). Names: @honorcat/*, --hc-* tokens, no "Verdict" outside the
  retired contracts' on-chain names and stored keys. New address honorcat.vercel.app (old kept).
  Tests: contracts 20, relay 74 (+1 skipped), web typecheck/lint/build.
- 2026-11-15: new direction "HonorCat: money in the air" (two-sided pots on a Gemini market,
  forward-priced exits). Replaces guarantees, early payouts and forward. C0 inventory written.
- 2026-11-15: F1 built and deployed (655dbc3 … b053595): catalogue of every active Gemini contract
  (14,782 contracts, 1,140 events, 9 categories on the first sweep) with quality under the rule its
  pot would get; quality-sorted picker with reasons; /markets; profile by time to close; live book
  check at creation (refuses with the reason); cost view on /early/new and the funder's pot page;
  quality now on the pot page; raw evidence only for members; "Data provided by Gemini" on every
  price. Tests: relay 88 (13 new catalogue tests), contracts 100, SDK 4, web typecheck/lint/build.
  First e2e caught a refund market failing the demo rule at creation (6¢ spread): the refund demo
  now needs a market at 15% or less whose book passes in the WebSocket observation.
- 2026-11-15: forward-spec.md replaced with the category-neutral version; guard-spec.md recorded as
  shelved (it never existed in the repo); phone test moved to "Later" (user decision).
- 2026-11-15: Forward spec (docs/forward-spec.md) milestone F0 done, no code changed: live weather
  (49 cities, Nov 15-16 highs, 79% one-sided books) and economics (11 events, Fed the only one
  traded) reported; docs/market-quality.md written; Gemini Market Data / API Agreement findings
  reported to the user. F1 not started: "Blocks current milestone" has an open entry (phone test).
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
- (none)

## Later
- CIRCLE_API_KEY is set (Vercel and .env) and valid (Circle's wallet endpoints answer 200), but
  `POST /v1/faucet/drips` answers 403 Forbidden: Circle requires the developer account to be
  upgraded to mainnet for the faucet API. Once upgraded, the 3-hourly refill works with no change.
  Until then, top up the relay wallet by hand from faucet.circle.com (Arc Testnet).
- Delete the Render service `honorcat-sampler` (created, then dropped by your decision; it has no key
  and cannot sign). Render dashboard: honorcat-sampler, Settings, Delete Web Service.
- Optional: repository secret `E2E_FUNDER_KEY` (a testnet key with a few test USDC) switches on the
  daily e2e workflow (.github/workflows/e2e.yml); without it the job skips quietly.
- The relay wallet funds test USDC for new passkey accounts only above 11 USDC; top it up from
  faucet.circle.com (Arc testnet) to enable that.
- While the laptop is off, only the Vercel sampler runs: nothing can be priced or settled until it
  is back (see /status).
- Vault pots 26-31 ($0.01 each) are past their deadline and only need the public `expire` call
  (refunds their creator). Calling it from here was blocked by the permission check; either allow it
  or set AUTO_EXPIRE=true in Vercel and the relay does it.
- QuickNode Stream still posts to https://verdict-phi-livid.vercel.app/api/webhooks/quicknode (same
  deployment, works). Switch the destination to https://honorcat.vercel.app/... in the QuickNode
  dashboard when convenient.
- Retired contracts: last open pot is guarantee d__stswg5M (vault pot 19), deadline 2026-12-14 05:00
  UTC (+1 h grace). After that the retired env vars can go.
- (Moved from Blocks, 2026-11-15, user decision.) Rubric item "A new user completes the recipient flow on a phone without help" needs a real person
  on a real phone. Automated stand-in passed (phone emulation + virtual passkey, joined in 5.5 s).
  Please hand a phone to someone who has not seen HonorCat, open
  https://verdict-phi-livid.vercel.app/e/G25xt3gjrG (listed, open to join until ~04:15 UTC) or a new
  pot, and note whether they joined without help.
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
