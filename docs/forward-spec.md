# HonorCat Forward (category-neutral)

## What it is
A funder locks USDC on Arc. Named recipients are paid before an event
happens, as soon as a Gemini prediction market holds above a
threshold. After the market settles, HonorCat records whether the
market was right. The early-payout flow already exists; this spec
makes it category-neutral, adds a cost view and tightens the
safeguards.

Not in scope: liquidation protection, a protection pool, a yield
layer, lending integrations, placing orders on Gemini.

## 1. Category-neutral, quality-first
- HonorCat works with any Gemini contract that passes the quality
  rules. No category is the main case.
- The market picker lists contracts from all categories, sorted by
  measured quality: two-sided book, spread, depth, time to close.
  Category and time-to-close filters are optional extras.
- Contracts that fail are shown as unavailable with the reason
  (one-sided book, spread too wide, too little depth). Do not hide
  them.
- Never invent or hardcode a market. Read everything from Gemini's
  public data and verify field names against the docs.
- Keep "Quick demo" with its two choices (instant, watch it cross),
  labelled as a demo.

## 2. "Markets that work today"
- A public page listing the contracts that currently pass, grouped by
  category, with bid, ask, depth, 24-hour volume and time to close.
- A summary per category: events listed, contracts passing, median
  spread, median depth.
- Refreshed regularly; show the time of the last refresh.
- Extend the read-only market report in docs/market-quality.md to all
  categories as the basis for this page.

## 3. Trigger profiles
- Two profiles only: the demo rule and the standard rule. Choose the
  profile from the contract's time to close. Propose the cut-off and
  tell me before applying it.
- No per-category rules.
- All parameters stay fixed at pot creation and appear on the terms
  screen.

## 4. What the promise costs
- On the funder's own page: payout total times the current YES price
  equals the fair cost of this promise today. Update it live and
  label it as an estimate.
- One line for US funders: this cost could be hedged by buying the
  same contract on Gemini. Information only, no order placement, no
  link to a trade ticket.

## 5. Pot cap against manipulation
- A pot's total payout may not exceed a multiple of the market's
  measured depth, so that moving the price costs more than the payout
  is worth.
- Propose the rule and the multiple with your reasoning, with example
  limits for one liquid and one thin contract. Wait for my approval.
- Enforce it at creation, show the limit to the funder, and add the
  attack and the remaining gap to the threat model.

## 6. Track record
- After each market settles, record whether the event occurred.
- Public record, overall and per funder: early payouts made, share
  where the event occurred, average lead time between payout and
  event.
- The landing page example is the best real pot where the line
  visibly crossed the threshold, whatever its category. Demo pots are
  labelled as demos.

## 7. Market data terms (until Gemini has answered)
- Public pages show the evidence hash and computed values only:
  window average, sample count, pass or fail, times.
- Raw samples are available to the pot's funder and recipients after
  sign-in. Keep the stored evidence format and the hashes unchanged.
- Add "Data provided by Gemini" with a link wherever a Gemini price
  or chart appears.
- Note in the docs that this reduces public verifiability, and why.

## 8. Submission readiness
- Judging criteria this year: Technical Execution, Product and UX,
  Innovation, Impact and Potential, Demo. Update docs/rubric.md to
  these five and re-map the existing items.
- Add a dated build log to the README from the commit history.
- Present the conditional payout in the README and on the developer
  page as a primitive others can build on, with HonorCat Forward as
  the first product (DeFi and Onchain Apps track).

## Milestones
F1. Quality-sorted market picker across all categories, "Markets that
    work today", trigger profiles, cost view and quality indicator,
    market-data changes from section 7. Deployed.
F2. Pot cap approved by me, enforced and tested; threat model
    updated.
F3. Track record live, landing example replaced with a real pot,
    rubric and README updated, end-to-end script passing against
    production.

## Rules
- Testnet only. Secrets only in environment variables.
- Verify Gemini and Arc specifics against their docs. Do not invent
  markets, endpoints or addresses.
- Do not change the Verdict vault. If something seems to require it,
  stop and tell me.
- Keep PROGRESS.md current, with my decisions under "Blocks current
  milestone" or "Later".
- Wording: no "bet", "wager" or "win". State that an early payout is
  final and that the market can be wrong. Testnet and "not insurance"
  notes stay on every page.
- Keep the existing design system: the scale, the cat and the bowl.
