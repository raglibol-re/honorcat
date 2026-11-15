# Backlog

Candidates from the improvement cycle (docs/improve.md), checked against docs/rubric.md.
Effort S / M / L. Fixes and polish before features; one unfinished feature at a time.

| # | What | Rubric item | Effort | Risk | State |
|---|---|---|---|---|---|
| 1 | Unknown guarantee id (`/g/<bad>`) logs two 404s in the console; show the not-found page from the server instead of a client fetch error | No console errors; loading/empty/error states | S | low | open |
| 2 | Secrets check of the repo history and the production browser bundle, with the command output as evidence | No secrets in repo or bundle | S | low | open |
| 3 | CI on GitHub Actions: contract tests, relay/SDK tests, web typecheck/lint, Slither with every finding explained | Full suite green; static analysis in CI | M | low | open |
| 4 | Threat model document (vault, books, passkeys, relay, trigger: spikes, thin books, spoofing, stale data, colluding signer, funder-chosen parameters) | Threat model current | M | low | open |
| 5 | README: setup, architecture, every Arc-specific choice, early payouts, current test counts | README | M | low | open |
| 6 | Demo script for a three-minute video and a Devpost description draft | Submission | S | low | open |
| 7 | Jargon pass outside "Under the hood" (pages in consumer mode) | No unexplained jargon | S | low | open |
| 8 | Loading / empty / error states on every page, checked page by page | Every page handles states | S-M | low | open |
| 9 | Early payouts M2 slice: create an early-payout pot (funder flow, demo template, terms screen) | Demo in under 60 s; terms screen; Gemini fit | M | medium | open |
| 10 | Early payouts M2 slice: live view with probability chart, threshold line, settlement rail states | Gemini fit; QuickNode/Arc visibility | M | medium | open |
| 11 | Samplers on free hosts (no paid services allowed by docs/improve.md) and 2-of-3 aggregation in the relay | Scripted early payout | M | high | open |
| 12 | Early payouts M3: recipient card, early payout, evidence on the proof page, post-settlement record | Recipient flow; Gemini fit | M | medium | open |
| 13 | e2e mode for early payouts: one early payout, one refund, 3 recipients | Scripted run twice in a row | M | high | open; needs deployer USDC and demo-template parameters that real books can meet |
| 14 | Landing page: one sentence and a live example of an early payout once it exists | Clear in the first minute | S | low | open |
