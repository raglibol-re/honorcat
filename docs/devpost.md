# Devpost draft: HonorCat

**Tagline:** Promises that always land. Paid before it happens.

## Inspiration
When a storm, a rate decision or a price move is coming, the people affected need money before it
happens, not weeks after a claim. Prediction markets already tell us, in real time, how likely an
event is. We wanted to turn that signal into a payment that arrives in time, with no forms and no
trust in a single operator.

## What it does
A funder picks any live Gemini prediction-market contract, sets a probability threshold (85% by
default) and sets money aside on Arc for a list of people. When the market's smoothed probability
stays above the threshold, everyone is paid at once, automatically. After the market settles,
HonorCat records publicly whether the event happened ("Confirmed" or "Market was wrong"); an early
payout is final. If the threshold is never reached, the funder gets the money back at trading close
(or, in the second mode, people are paid at settlement if the event happened).

Recipients join with a passkey: no wallet, no app, nothing to file or claim.

## How we built it
- **Arc (Circle's L1, testnet):** USDC is the gas token; funders sign once (EIP-3009) and our relay
  submits create, fund and open in one Multicall3From batch with an Arc Memo explaining why money
  moved. Settlement is final in about a second. Passkey accounts are verified on-chain with Arc's
  P-256 precompile. A Merkle book pays thousands of payees from one pot (~74k gas each, measured).
- **Gemini:** the trigger reads Gemini's public order book (WebSocket `depth5`, a snapshot every
  second). A reading counts only with a tight spread, real size on both sides and fresh data; the
  time-weighted midpoint must hold above the threshold for a full window. Settlement outcomes come
  from Gemini's public events API.
- **Trust:** three independent samplers (Vercel, GitHub Actions, a local machine) each sample,
  decide and sign from their own data; a 2-of-3 resolver contract releases the money. Every
  sampler publishes an integer-only evidence record; its hash is signed and the combined evidence
  root is in the payout memo. The proof page recomputes every record in the browser.
- **QuickNode Streams** pushes every block's events to the app (and keeps one sampler running).
- Next.js on Vercel, Postgres (Neon), Foundry (Arc Foundry), viem.

## Challenges
- Real order books are thin: a contract quoted at 98% can flip to a one-sided book between
  snapshots. Our rule refuses those readings, so the demo finder watches books for twelve seconds
  and only picks markets that actually meet the rule.
- Serverless functions cannot sample every two seconds; one sampler runs in long bursts from the
  Streams webhook, the others are always-on processes.
- Keeping everything verifiable without changing the vault: parameters are committed in the pot's
  condition ID, evidence is published and hashed, and the vault only needs the 2-of-3 signature.

## Accomplishments
- Early payouts settled on Arc testnet from live Gemini data by 2 of 3 independent samplers, with
  public, recomputable evidence; the scripted end-to-end run (one early payout, one refund) passes
  against production.
- 108 contract tests (unit, fuzz, invariants), 74 relay tests including replays of recorded Gemini
  feeds, Slither in CI with every finding explained, a written threat model.

## What we learned
Market data is not a price feed: spreads, sizes and staleness matter as much as the midpoint.

## What's next
Funder-tunable windows per market type, larger recipient lists via the Merkle book, independent
sampler operators, and a proof-based resolver.

## Built with
Arc, USDC, Gemini Prediction Markets API, QuickNode Streams, Solidity, Foundry, OpenZeppelin,
TypeScript, viem, Next.js, Vercel, Neon Postgres, WebAuthn/passkeys.

**Testnet only. Not insurance. No hedge is placed.**
