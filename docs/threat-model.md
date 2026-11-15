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
- Static analysis: Slither in CI (findings explained in docs/slither.md).
- Not formally verified (symbolic tests were deprioritised for the deadline).
