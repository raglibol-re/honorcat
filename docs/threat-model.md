# Threat model

Scope: Verdict (vault, books, resolvers, relay) and HonorCat (guarantees, Merkle payouts, early
payouts) on Arc testnet. For each threat: what stops it, and what does not. Updated 2026-11-15.

Trust in one line: **the vault trusts only the pot's resolver signature**. Everything else (relay,
indexer, web app, samplers' data) can fail without taking money that the contracts do not allow.

## Actors and assets

| Actor | Can | Cannot |
|---|---|---|
| Funder / merchant | create and fund a pot by signature, set its terms once | change the terms, resolver, payees or deadline after creation |
| Recipient / customer | join with a passkey or key, withdraw | receive more than their amount; join after lock time |
| Resolver key (relay EOA) | sign outcomes for Gemini/API/HTTP pots it resolves | resolve pots whose resolver is another address; sign after `deadline + grace` |
| Samplers (3 keys, 2-of-3 `MultisigResolver`) | sign early-payout results | resolve a pot with fewer than 2 signatures |
| Relay (Vercel app) | submit transactions, pay gas, index, aggregate signatures | move money without a valid resolver signature; change a pot's terms |
| Anyone | call `resolve` with a valid signature, `expire`, payouts, Merkle claims, sweeps | redirect a payment: every payout goes to the payee/recipient/account fixed on-chain |

Assets: USDC in the vault and books; resolver and sampler keys; the deployer key (testnet funding);
`ADMIN_TOKEN`, `CRON_SECRET`, `QUICKNODE_STREAMS_TOKEN`; the Postgres read model.

## Vault and books

| Threat | What stops it | What does not |
|---|---|---|
| Paying out twice | `Status` moves once from Open to Resolved/Expired; books set `settled`, a claim bitmap (MerkleBook) | — (invariant tests: conservation, no double payout) |
| Payout without a valid result | `resolve` checks EIP-712 `Resolution(potId, conditionId, outcome)` against the pot's resolver (EOA or ERC-1271) | a compromised resolver key (see below) |
| Redirecting money | payees, shares and refundTo are fixed at creation; books pay only enrolled accounts / Merkle leaves | — |
| Signature replay across pots/chains | digest binds chainId, vault, potId, conditionId | — |
| Front-running a gasless funding | the EIP-3009 nonce is derived on-chain from every pot parameter; `receiveWithAuthorization` requires `msg.sender == vault` | — |
| A blocklisted payee blocking settlement | failed transfers become `claimable` | the payee needs to be un-blocklisted to withdraw |
| Money stuck if nobody resolves | `expire` after `deadline + grace`, callable by anyone, refunds `refundTo` | — |
| Merkle list swapped by the relay | the funder's EIP-3009 salt commits to the root; root changes only before lock time, versioned events | a funder who wants a different list can still change it before lock (by design) |
| Over-allocated Merkle tree | claims capped at the declared total and the pot | — |

## Early payouts: the probability trigger

| Threat | What stops it | What does not |
|---|---|---|
| **Price spike** (one trade or quote jumps above the threshold) | a single sample never triggers: the time-weighted midpoint over the full window must stay at or above the threshold, with a minimum number of valid samples (tests: "a short spike does not trigger") | a spike that is sustained for most of the window is, by definition, the market's view and triggers |
| **Thin book** (tiny orders at extreme prices) | a sample counts only with a minimum size on both sides and a maximum spread; one-sided books are invalid (observed live: a HYPE contract flipping one-sided; no trigger) | a well-funded actor posting real size on both sides within the spread limit for the whole window |
| **Spoofed orders** (orders placed to move the midpoint, then pulled) | they must persist across many samples spanning the window from independent samplers; pulling them breaks validity or moves the average back | an attacker willing to keep real, executable size on the book for the window. Mitigation: higher thresholds, longer windows and larger minimum sizes for larger pots (parameters are per pot) |
| **Stale data** (feed stops, a host lags) | samples older than the staleness limit are invalid; the newest sample must be fresh at the window end; gaps carry no weight; Gemini `depth5` sends a snapshot every second, so quiet books stay fresh | a sampler lying about timestamps (see colluding signer) |
| **Market under review / voided** | samplers do not trigger while `under_review`; `invalid` before a trigger → refund; after a payout → recorded "market voided", payout stands | Gemini changing a result after settlement (the record shows what was observed and when) |
| **Trigger after trading closes** | arming ends at trading close; a window ending after close is rejected by the relay | — |
| **One sampler lying or compromised** | 2 of 3 must each sign from their own data; every submission is verified (authorised signer, signatures, record recomputes to its decision, window inside the armed period) | a sampler can fabricate quotes in its own record: evidence proves consistency with the rule, not that quotes came from Gemini |
| **Two samplers colluding** (or two keys stolen) | nothing on-chain: 2 of 3 is the resolver. Detection: every record is public and checkable against Gemini's public data afterwards | this is the trust assumption. Keys are on different hosts (Vercel, GitHub Actions, a local machine) to make it harder |
| **The relay withholding or delaying** | anyone can submit `resolve` with the published 2-of-3 signature; `expire` refunds after the deadline | a relay that hides submissions it received (samplers can publish elsewhere; not built) |
| **The app lying about parameters** | each sampler recomputes the conditionId from the parameters and checks it on-chain before watching; the record's conditionId must commit to its parameters | — |
| **Funder choosing parameters that favour themselves** (e.g. a threshold the market can never reach, a window longer than the time to close, absurd size requirements) | parameters are committed in the conditionId and shown in plain words on the terms screen before anyone joins; validation rejects impossible windows; recipients see the live chance vs threshold | a funder can still offer a promise that is unlikely to pay; the terms screen makes that visible, it does not forbid it |
| **Recipient-side manipulation** (a recipient pushes the market to trigger their own payout) | same as spoofing; payouts are small fixed amounts, so the cost of holding size for the window exceeds the gain at these scales | a large pot on a thin market. Mitigation: per-pot parameters, larger minimum sizes |

## Keys, relay and app

| Threat | What stops it | What does not |
|---|---|---|
| Resolver EOA key leak | it can only resolve pots whose resolver is that address, within the deadline; MultisigResolver for pots that need more | an attacker could resolve the relay's own pots either way before the relay does |
| Sampler key leak | one key is not enough (2 of 3); rotate by deploying a new resolver (owners are immutable) | two leaked keys |
| Admin token leak | it can register integrations and report outcomes for `manual` conditions only | — |
| Webhook spoofing (QuickNode) | HMAC with `QUICKNODE_STREAMS_TOKEN`; the RPC poller is the primary indexer anyway | — |
| Database tampering | the DB is a read model: money moves only on-chain; evidence records are re-verified from their own content; pages read balances and pot state from the chain | someone with DB access could hide a pot from the UI |
| Secrets in the repo or bundle | `.env` is git-ignored; nothing secret uses `NEXT_PUBLIC_`; `scripts/check-secrets.mjs` scans history and the production bundle | — |
| Passkey account takeover | WebAuthn P-256 signatures verified on-chain (Arc precompile), rpIdHash bound, nonces | a stolen unlocked device |

## What is proven vs tested

- Unit, fuzz and invariant tests (Foundry): conservation, no double payout, refunds only to
  `refundTo`, Merkle claims capped, blocklist deferral.
- Trigger: 30 replay and property tests (synthetic and recorded Gemini feeds); 6 sampler tests.
- Static analysis: Slither in CI; the build fails on any finding not explained in
  `contracts/slither-triage.json` (24 of 24 explained).
- Not formally verified (symbolic tests were deprioritised for the deadline).

## Two-sided pots: manipulating an exit price (cap arithmetic, 2026-11-16)

An attacker who owns one side of a pot of size `N` requests an exit and tries to hold the Gemini
mid `Δ` away from fair value, in its favour, for the whole exit window. Its gain is at most
`N · Δ` (its share moves by `Δ` of the pot).

**Cost, per contract the attacker must take out of the book** (`C₅` contracts resting within 5¢ of
the mid on the side it pushes against; prices in dollars, `P` the contract price):
- Entry: walking the book up by `Δ` costs on average `Δ/2` above fair per contract (depth spread
  evenly over the 5¢ band).
- Unwind: after the window the price returns to fair; selling back, or holding to settlement, loses
  that overpayment in expectation: another `Δ/2` relative to the price paid near the top. Counted
  together with the entry as `Δ/2` per contract (the conservative reading: only the average
  overpayment is lost).
- Gemini taker fees (fee schedule of 2026-03-12, contracts listed from 2026-03-18:
  `0.07 × C × P × (1 − P)`, maker `0.0175`, no settlement fee): paid on entry and on exit,
  `0.14 · P(1−P)` per contract round trip.
- Holding: other traders refill the book during the window, which only adds cost; not counted.

So `cost ≥ C₅ · (Δ/2 + 0.14·P(1−P))`. Requiring `cost ≥ 2 · gain = 2 · N · Δ` gives

```
N ≤ C₅ · (Δ/2 + 0.14·P(1−P)) / (2Δ) = C₅ · (1/4 + 0.07·P(1−P)/Δ)
with Δ = 0.05:   N ≤ C₅ · (0.25 + 1.4 · P(1−P))
P = 0.50 → 0.60 · C₅      P = 0.90 → 0.376 · C₅      P = 0.95 → 0.317 · C₅      P → 0 or 1 → 0.25 · C₅
```

**Chosen**: `N ≤ 0.25 × C₅` (the worst case over all prices, so the 2× margin holds whatever the
price), capped at $25 on testnet. Your expectation of about 0.5× holds only near `P = 0.5`; across
the whole range the numbers support 0.25×.

**What this does not cover.** The model assumes depth spread evenly across the 5¢ band. If nearly all
of it sits at the best price, the attacker overpays less and the estimate is optimistic; the window
average (60 s), the rule's per-sample size and spread limits and the second independent sampler are
the remaining defences. Moving the price by more than 5 points needs depth beyond the band, which
the cap does not measure.

## Two-sided pots: threats (from docs/pot-design.md, D0/D1)

| Threat | What stops it | What does not |
|---|---|---|
| **Stale-price exit** (someone knows the result before the market) | The exit price uses only samples after the request (`windowStart = requestTime + D`, fixed by the contract); the request is binding | If the market itself moves only after the window, an informed exiter still gets the pre-move price; that is fair value at that time |
| **Price manipulation in thin books** | Window average (not a tick), the rule's spread and size limits per sample, the cap on N tied to depth, two independent samplers | A well-funded actor can still move a thin book for a whole window; the cap bounds what they can gain, not whether they try |
| **Colluding signers** | M of N (2 of 3) on different hosts; evidence records published; each pot's resolver fixed at creation | Two colluding samplers can sign a false price; evidence makes it detectable afterwards, not impossible. A larger, more independent signer set is the real fix |
| **Griefing by repeated exit requests** | One pending exit per pot, a cooldown after a failed exit, the request is binding (a real exit if priced), the exiter pays the fee | Requests that fail on bad data cost the other side waiting time, not money |
| **Takeover front-running** | First valid takeover wins; the taker escrows the maximum; the price is the forward window, so being first gains no price advantage | A bot can take over every exit; that is allowed by design (it pays the fair price) |
| **Creator-chosen tolerance** | Tolerance is public on the offer; the joiner sees the entry price and the live price before joining; a protocol maximum (proposal: 5 points) | A joiner who does not look can accept a stale entry price within the tolerance |
| **Signer outage** | `abandonExit` after the timeout, `expire` after the deadline: funds always come back | While signers are down, no exit or settlement happens |
| **Relay outage** | Anyone can submit attestations and settlements | Someone must still run the samplers |

The cap's arithmetic for thin-book manipulation is in the section above. What stops each threat on-chain is tested in contracts/test (window fixed by the request, one pending exit, cooldown, first takeover wins, tolerance at most 5 points, abandon and expire paths).
