# HonorCat: early payouts triggered by market probability

## Summary
HonorCat's main product changes. Money is locked in a pot and paid out
the moment a Gemini prediction market considers an event very likely,
before the event happens, so recipients can prepare. After the market
settles, HonorCat records publicly whether the market was right.
Tagline stays: "Promises that always land." New line: "Paid before it
happens."

This replaces the guarantee templates as the main flow. Keep from the
earlier product work: passkey accounts, the public proof page, the
checkout-style badge (now a "funded" badge), the plain-language terms
screen, public numbers, and the honor record. Drop: discount
comparison, coupons, tiered refunds, service promises.

Do not change the Verdict vault unless unavoidable. If you believe a
change is needed, stop and present it.

## How it works
1. A funder picks a live Gemini market contract, sets a probability
   threshold (for example 85%) and locks USDC for a list of recipients.
2. HonorCat watches the contract's implied probability.
3. When the smoothed probability crosses the threshold, the pot pays
   all recipients at once.
4. When the market later settles, HonorCat records whether the event
   occurred.
5. If the threshold is never crossed, behaviour depends on the pot's
   mode (see below).

## Pot modes
- early-only: pay on crossing; otherwise refund the funder at market
  close.
- early-or-outcome: pay on crossing, or at settlement if the event
  occurred without the threshold being crossed; refund only if it did
  not occur.
Implement both in the resolver logic, not in the vault.

## The probability trigger (the core of this work)
A raw price tick must never trigger a payout. Build a trigger that is
hard to manipulate and easy to audit.
- Read the contract's order book and trades from Gemini's public
  market data. Check the docs for which REST and WebSocket data is
  public, and tell me what you found before building.
- Define probability as the midpoint of best bid and ask, only when
  the spread is below a maximum and both sides have a minimum size.
  Otherwise the sample is invalid.
- Trigger only when a time-weighted average over a window stays at or
  above the threshold, with a minimum number of valid samples and no
  stale data. Window, spread, size and sample limits are parameters
  fixed at pot creation and shown on the terms screen.
- Each signer samples independently. Use the existing multi-signer
  resolver so that one relay alone cannot trigger a payout.
- Store the evidence for every trigger: the samples, their timestamps
  and the computed average. Publish it on the proof page and put its
  hash in the signed result and in the payout memo, so anyone can
  recompute the decision.
- The relay currently runs inside the Vercel app. Sampling every few
  seconds will not fit that model. State the constraint and propose
  how to run the samplers. Wait for my choice.

## After settlement
- Record whether the event occurred, as a memo transaction linked to
  the pot, and show the pot as "Confirmed" or "Market was wrong".
- Feed this into the honor record and public numbers: early payouts
  made, share where the event occurred, average lead time between
  payout and event.

## Funder flow
- Pick a template: temperature, rate decision, price, or the demo
  template (a fast-settling crypto market, clearly labelled).
- Only real, active Gemini contracts. Never invent markets.
- Threshold slider with context: current probability, recent history
  as a chart, time until the market closes. If Gemini offers public
  price history, show how often this threshold would have been crossed
  recently and how often the event then occurred; label it as
  historical, not a forecast. If not available, leave it out.
- Choose the pot mode, recipients (join link with passkey, or the
  Merkle list if that mode exists), amount per recipient.
- Fund by signature. Then show the share link, QR code and badge.

## Recipient flow (mobile first)
- Join with a passkey. The card shows the promise in one sentence, the
  amount, the live probability, the threshold and the time left.
- On trigger, the card shows "Paid early" with the reason and the
  lead time. After settlement it shows whether the event occurred.
- Nothing to file or claim. Withdrawal to an external address is
  optional.

## Live view
- A probability chart with the threshold as a line, the raw
  probability and the smoothed value drawn separately, and a countdown
  to market close.
- States on the settlement rail: Locked, Armed, Triggered, Paid,
  Confirmed.
- The trigger moment plays the real sequence: threshold crossed,
  signatures collected, payment sent, with measured times.
- "Under the hood" shows the trigger parameters, the evidence and the
  signers.

## Terms and honesty
- One plain-language terms screen per pot: the contract, the threshold,
  the trigger rule in words, the pot mode, what happens if the market
  is cancelled or data is missing. Define these edge cases with me
  first.
- Say clearly that the market can be wrong and that an early payout is
  final.
- Testnet banner. A note that this is a demo and not insurance. No
  hedge is placed.

## Threat model
Extend the threat model document: price spikes, thin books, spoofed
orders, stale data, a colluding signer, a funder choosing parameters
that favour themselves. For each, say what stops it and what does not.

## Milestones (each must be verifiably complete)
M1. Trigger engine with tests. Tests replay recorded and synthetic
    feeds: a steady rise triggers; a short spike does not; a wide
    spread, thin size or stale data does not; missing signers do not.
M2. Funder flow and live view, deployed.
M3. Recipient flow, early payout, evidence on the proof page, and the
    post-settlement record, deployed.
M4. End-to-end script against production on the demo template: one run
    that triggers and pays, one run that never triggers and refunds,
    both with three recipients.

## Rules
- Testnet only. Secrets only in environment variables.
- Check Arc and Gemini specifics against their docs. Do not invent
  addresses, endpoints or fields.
- Keep a short PROGRESS.md: what is done, what is next, what is
  blocked. Update it at the end of every working turn.
- If something needs my decision, write it into PROGRESS.md under
  "Needs decision" and stop working on that part.
- Follow the existing design brief and wording rules.