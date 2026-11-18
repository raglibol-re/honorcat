# Progress

## Blocks current milestone

- (resolved 2026-11-18 16:45 UTC) **Production database out of transfer**: Neon project `honorcat`
  (free plan) used 6.25 GB of network transfer in two days (5 GB a month allowed; the earlier
  `verdict` database ran out the same way). Cause, measured: the market catalogue is 24,221
  contracts (~16 MB of JSON), and every new Vercel instance read all of it for the landing page and
  /api/catalog. Fix (91a0a95): pages filter in SQL and read only the rows they show; the usable set
  (fresh books only) is cached per instance; a per-query read meter logs `[db] bytes` every ten
  minutes. Owner's choice: a new free Neon project `honorcat-2` (snowy-hat-61221863), rebuilt from
  public sources with scripts/rebuild-db.ts (all pots and events, catalogue, markets, practice
  pots). Lost with the old database until 1 Dec (it cannot be read): names, passkey registrations,
  drafts, sampler averages, early samples. The GitHub sampler workflow was removed later the same day.
- (resolved 2026-11-18) One-call funded entry: the owner chose **v2.1 with a roll entry**:
  `openFunded(fromPot)` opens the next rope with both sides funded by the caller, at the previous
  rope's recorded division price (knock-out or expiry, within 15 minutes, once per rope), plus a
  division record per pot; the first rope opens through the normal join window. Post margin for ropes:
  **2 points**. v2.1 is a redeploy at a new address (asked before deploying).

**No deploys 2026-11-19 00:40 to about 05:40 UTC**: perps e2e runs on live games (data/perps-e2e-nhl.log, data/perps-e2e-nba.log).

## Next: Grok Catbot minds perps (spec 2026-11-18)

Named **Grok Catbot** by the owner (a cute pop-up in HonorCat's style; replaces the spec's "no
GrokCat" line). Starts only after perps pass every end-to-end run (knock-out runs tonight). Step 0
done: xAI's docs read and checked against /api/mcp, see docs/grok-bot/docs-check.md.

## Status against "finish what is open, then lives and perps done properly" (2026-11-18)

| # | Item | Status |
|---|---|---|
| 1 | Two offers only: normal pot and perp; no stand-alone short rope | done (create page: Normal and Perp cards; the normal flow has no leverage; the Perp card says "coming soon" until the switch, `?perps=preview` shows it) |
| 2 | v2 pot contract: posts, clamp, knock-out priced after the trigger, expiry, cap, minimum distance, maximum leverage, maker treat, exit fee on the part exited, referral, copycat, no operator fee, tests | done (72 tests, deployed to testnet, switch off) |
| 2 | Normal v2 pot behaves exactly like v1, test on the same inputs | done (RopesV1Equivalence fuzz; found and fixed a stricter cap) |
| 2 | One-call entry point opening a pot with both sides funded at an attested price | done as the owner chose: v2.1 roll entry `openFunded(fromPot)` at the previous rope's division price; deployed 0x5489…B62E |
| 2 | Joiner sets its own post | not built (withdrawn) |
| 3 | Lives only in perps; normal pots say "taking one ninth off the rope"; cat-head symbol for lives | not started (today's receipt and v2's extra lives still say "lives" with paw marks) |
| 4.1 | Perp rope geometry (d from leverage, posts q ± d, both put in S) | done (v2.1: symmetric rope, 2-point post margin, no takeover by one holder of both sides) |
| 4.2 | Chain contract (budgets, roll, stop renewing, leave now, handshake, withdraw, optional stop-loss) | done: HonorCatPerps 0x2865…0CEB on Arc testnet (unit, fuzz, invariant tests); stop-loss not built (optional) |
| 4.2 | Relay: first rope, credit and roll, knock-outs, expiries; list and detail API | done and in production (switch off) |
| 4.2 | Arc e2e gate before the perps switch | 2026-11-18 run on ZEC (perps 1 to 4): chain of 3 ropes rolled after expiries; ended by leave now (exit fee 1% to the other side), by stop renewing, by running out of lives. Open: a knock-out and a roll after a knock-out (runs on live NHL and NBA games tonight, 00:40 and 02:40 UTC) |
| 4.3 | Backtest per market type, live games separately, with lives | partly: simulation and model-based BTC done, recorder running since 14:00 UTC, recorded rows and lives pending |
| 4.3 | Measured bias in plain words on the create page | not started |
| 4.3 | README: perps as a chain of short ropes | not started (README has v2 short ropes) |
| 5 | Create page with two cards; perp form with summary sentence | done (market, side, leverage steps the contracts accept, stake per life, lives default 9, rope life, summary, cat-head lives) |
| 5 | Join with leverage and lives; perp page; rope-end animation | done (/perps/[id]: rope between posts with price and time left, both players' lives, results, ropes so far, leave now, stop renewing, add lives, take out spare money, join with own lives, a short banner when a rope ends); passkey calls to HonorCatPerps relayed |
| 5 | Open pot shows an open seat on the empty side | done (pale cat outline and "open seat" instead of a cat; user request 2026-11-18) |
| 5 | Normal pot page with "take one ninth off the rope" | partly (receipts say it; buttons and help text not yet) |
| 5 | Open sides, leaderboard, copycat show normal or perp | done for the pots page and the landing (Normal and Perp tags; open perps listed once switched on); copycat is normal pots only; the leaderboard ranks players, not pots |
| 5 | Perps through the real pages on production | done 2026-11-18 (perp 5): two new passkey accounts; open through the form, join from the perp page, relay started rope 1, leave now, both took their money out |
| 5 | Perp warning (a life can be lost in minutes) | done (form and perp page) |
| 6 | Partial-exit receipts (headline, bar, lines, three decimals, technical line) | done (needs the lives wording from item 3) |
| 6 | One smoothed price with a timestamp for every viewer | not started (each browser smooths its own quotes) |
| 6 | Paw trail since the pot started, entry and exits marked, legend | not started (trail shows the last few positions) |
| 6 | Practice mode says the visitor plays the practice cat with test money | done (create page practice note) |
| 6 | Status and sponsor pages: no retired vault, Streams primary, consistent numbers | not started |
| 6 | Price chart from the entry onward or saying where history is missing | not started |
| 6 | Treats, referral link, copycat on leaderboard; follow | done except "follow" |
| 6 | README: challenges, economics, Arc with every address, Stream set-up, dated build log | partly (all exist; challenges section and v2/perp parts to complete) |
| 6 | No further Grok Bot work | noted |
| - | Gemini links | fixed 2026-11-18: gemini.com/predictions/<EVENT_TICKER>/<slug> (the slug alone redirected); Gemini Predictions redirects visitors outside the US to its home page whatever the link |

## HonorCat v2: short ropes and treats (2026-11-18)

Design note: docs/rope-design.md. State: contract with tests, knock-out and expiry relay, create page
and rope view done; **nothing deployed**, v1 untouched. Next (after the owner's go): backtest (c),
treats in the interface (d), leaderboard and cosmetics (e), then end-to-end runs and deployment.

**Decisions by the owner (2026-11-18)**
- D1 expiry: at least 2 h before trading closes, at most 7 days, at least 10 minutes. Backtest to
  report live-game pots separately; live-game short ropes labelled "jumpy" in the interface (done).
- D4 cap: the simple rule, size ≤ 0.25 × thinner-side contracts within 5¢ (existing depth
  attestation). The attested cost to each post goes in the README as the refinement.
- D5: minimum distance max(5 points, 2 × spread); maximum leverage 10× crypto, 5× elsewhere.
- D6/D7: exit fee 1% of the pot value exited, i.e. 1% × (U − L) × N × fraction (equals today's fee on
  a normal pot; tested never above 1%); maker treat 0.25% of the joiner's deposit; referral 20% of
  fees for 20 pots; copycat 5% of profit; no fee on knock-out or expiry.
- D10: production data only through a read-only role or a branch; only aggregates in the repository.
- Scope: everything in spec sections 1 to 7 in the contract now (it cannot be upgraded).

**Decisions taken by default (my recommendations, not answered explicitly)**
- D2: no valid expiry price → three more windows fixed by the expiry (each W + 60 s later), each
  skippable by anyone after the 10-minute timeout; then clamped settlement; then deposits back at the
  deadline.
- D3: one extra life moves the side's own post by its original distance, at most 8 lives, never past
  0 or 100; it also bumps the pot's nonce, so a knock-out attested against the old posts is void.
- D8: self-referral through a second account is accepted and will be stated in the README (it is a
  20% fee discount paid by the counterparty, never a profit); the contract rejects referring oneself.
- D9: backtest on recorded samples (aggregates only), a recorder started now, and model-based crypto
  paths, each labelled.
- D11: posts are set at the join, around the entry price, from distances fixed at creation; a side
  with a post deposits exactly its distance.
- Not in the note, chosen while building: prices snap to 0.01 points and size counts hundredths of a
  contract, so every share is exact (no division); fees round down (so "never above 1%" holds
  exactly); the copycat treat is held back (5% of each payout) until the copier's tenure ends, then
  5% of the real profit goes to the leader and the rest back; a transfer ends a copy tenure and the
  referral share; the testnet maximum ($25) applies to the pot value, also after extra lives.

**Built**
- Contract `HonorCatRopes` + `HonorCatRopesExtension` (delegatecall, one address holds all funds;
  23.8 KB and 19.8 KB), `DeployRopes.s.sol` (also deploys a MedianResolver for it). Tests: 72 new
  (43 unit, 14 treats, 6 fuzz × 1,000 runs, 4 invariants × 64 runs × 400 calls, 3 MedianResolver,
  digest vectors); all 158 Foundry tests green. Halmos: 3 checks, no counterexample, not proven
  (timeouts on the 256-bit products, as for v1).
- Relay: v2 pots at 1,000,000,000 + id in the read model; contract-aware windows, sampler records,
  signed averages, proposals and submission; sampler knock-out watch (`/api/hc/sampler/knock`);
  expiry windows opened and skipped by housekeeping; v2 depth (spread, category); passkey calls to
  v2; honor record reads v2 events. Inactive until deployments/<chain>.ropes.json exists and
  `ROPES_FOR_NEW_POTS=true`. Digests checked byte for byte against the contracts.
- Web: leverage control with plain words, expiry choice and the "short rope ends sooner" warning
  (create page, only when v2 is on); rope view with posts, paw marks for extra lives and the clamp;
  expiry countdown and an extra-life panel on v2 pot pages; preview at /design/rope (axe clean,
  no overflow at phone and desktop width).
- Not yet for v2 pot pages: leave, handshake, nets/bowls, takeover buttons (the v1 ones are hidden
  there because they call the v1 contract).
- Local environment: node_modules links still pointed at the old folder name ("verdict"); 2,013
  links were repointed to this folder (no reinstall, so the running samplers were not disturbed).
  Samplers must be restarted with this code to measure v2 windows.

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
- 2026-11-16: build list parts 6 to 8 done: Streams first (34 of 34 events since it resumed, share on
  /status), the README rewritten (architecture, economics and risks, Arc, the Stream, Grok Bot, build
  log), the helper cat's wish box and net/bowl sentences (pot 26). Open, needing you: Circle's
  passkey-domain setting for smart accounts; xAI credits only if GrokCat should speak through Grok.
- 2026-11-16: build list part 4 (price chart, picker sentences) and part 5 (Grok Bot as an MCP tool
  connection: AI opponent on practice pots and cat sitter on the player's own pots, no contract
  change: exits alone only when signed in advance, the rest by approval). Verified on production with
  pots 24 (agent opponent) and 25 (cat sitter). Next: part 6 Streams, part 7 README, part 8 GrokCat.
- 2026-11-16: GrokCat (docs/grokcat-spec.md, K0 in docs/grokcat-k0.md). No xAI credits and no real
  money (your rule), so no Grok calls: the helper cat answers from our own templates until credits
  exist, and is not presented as Grok. Built for approval: the helper cat (light coat, ink outline,
  signal collar) with seven poses on /design/cat, and one bubble ("options in words") beside the exit
  confirmation, with the numbers-only-from-our-data and no-advice checks (relay/test/helper.test.ts).
  Waiting for approval before using it elsewhere. Circle smart accounts: built, hidden until the
  client key's domain / Modular Wallets setting is confirmed in Circle's console (-32012 "entity config").
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

- 2026-11-17: everyday-app spec (Circle kits, docs.arc.io samples). The user chose "build what works
  now"; all of it is live and checked on production (docs/rubric.md section 15):
  - Part 6 (634069d): every action shows its Arc fee in cents (`/api/hc/fees`, 7-day average per
    action from the relay's receipts); every payout is a receipt sentence with how long it took and
    the transaction carrying its memo (`web/src/lib/receipts.ts`, tested).
  - Part 4 (ff0ddf8, c308c3d): send test USDC to another player by name (each match shows its cat
    and short address; the confirm step repeats both) and "Send my $X to…" on a pot that paid you.
    Passkey sends are signed transfers the relay pays for (`relay/src/send.ts`, memo `t: "send"`).
    "Withdraw everything" for pot players used the old guarantee-only path and returned 403; it now
    uses the same transfer. Production runs: $0.10 to Willow from /account (0x71243c66…27ab) and
    from pot 28's "Send my $0.49 to…" (0x31d790be…a492), pot 28 paid out in 93 s.
  - Part 2 (564ea27, d306482): home currency. Euros at a stated rate from Circle's Stablecoin Kits
    rates endpoint (the one Swap Kit `getTokenRates` uses; the Swap Kit package did not load on
    Vercel, so the endpoint is called directly). Display only; payouts stay USDC.
  - Part 3 (dfc4f20): the Gateway panel in the unified-balance words of the Arc multichain wallet
    sample (which uses direct Gateway like ours); deposits show as pending until finality.
  - Part 7 (dfc4f20, 435ff2d): every asset and Circle product with a live count, rate or transaction
    on /how-it-is-built (`/api/hc/evidence` `everyday`) and in the README. CCTP corrected to "built
    earlier, not on the current pages".
  - Part 1, Onramp only (435ff2d): "Add money by card or bank" as a clearly marked demo following the
    USDC Onramp Demo sample; no invented prices; says why (needs a Circle API key; the sandbox cannot
    settle on Arc testnet).
  - Also: full team names on pot pages after a game leaves the catalogue (from Gemini's event
    participants); each pot page has its own title for tabs and the screen-reader route announcement.
- 2026-11-17: user feedback "too much text" on My money: the page is rebuilt around the balance
  (`web/src/app/(site)/account/MoneyView.tsx`, 02911f6): balance first with the cat and one Sign out;
  three actions (Add money, Send, Withdraw) open one at a time; Add money offers "From another chain"
  (Gateway, two steps) or "Card or bank" (the demo, its reason behind "Why a demo?"); currency as a
  one-line $ / € switch; Grok Bot in one sentence and only when signed in (it had a second sign-in).
  The old AccountView/AccountGateway are removed; `/account#gateway` opens Add money, from another
  chain. Phone height 3,325 px to about 2,100 px. Signed-in axe check on every view: 0 issues (fixed
  the fur swatches' unnamed pictures on the way), no overflow.

## In progress
- (none)

## Next
- Once Circle Modular Wallets work (console setting): switch on the built Circle smart accounts, then
  the rest of the everyday spec: Circle-sponsored gas for new accounts (part 1), Earn (part 5), EURC
  payouts through Swap Kit (part 2), Bridge on exit (part 3).

## Blocks current milestone
- Circle Modular Wallets: the console has no "Modular Wallets" entry the user can find; sign-up fails
  with -32012 "Cannot find the entity config". Everything above that needs a Circle smart account
  waits for it.

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
- (2026-11-18) The GitHub Actions sampler workflow was removed: its secret was never set, so it only
  polled the app every 15 minutes. The `SAMPLER_KEY_GITHUB` signer runs on this machine instead.
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
