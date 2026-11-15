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

## In progress
- Rubric goal (docs/rubric.md), working by docs/improve.md. Evidence in docs/rubric-evidence.md, candidates in BACKLOG.md.

## Next
- M2 funder flow and live view, M3 recipient flow, evidence on the proof page, post-settlement record,
  M4 e2e on the demo template.
- Then: phase I threat model and static analysis, minimal phase H, phase E only if time allows.

## Blocks current milestone
(none)

## Later
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
