# Early-payout trigger (M1)

Code: `relay/src/trigger/` (exported as `trigger` from `@verdict/relay`). Tests: `relay/test/trigger.test.ts`.

## The rule

A raw price tick never triggers a payout. Every sampler takes one sample per interval from Gemini's
public order book and classifies it:

| Status | Meaning |
|---|---|
| `ok` (0) | counts |
| `missing_side` (1) | no bid or no ask |
| `crossed` (2) | bid at or above ask |
| `spread` (3) | ask minus bid above the maximum spread |
| `bid_size` / `ask_size` (4, 5) | best bid or best ask size below the minimum size |
| `stale` (6) | the book was last confirmed current longer ago than the staleness limit |
| `off_tick` (7) | a price or size not representable in the market's units |

The probability of a sample is the midpoint of best bid and best ask (for a "no" pot: one minus the
midpoint). Over the window ending now, each valid sample holds its midpoint until the next sample,
the window end, or the staleness limit, whichever comes first; invalid samples and gaps carry no
weight. The pot triggers only when all of these hold:

1. at least the minimum number of valid samples in the window;
2. the newest sample is valid and no older than the staleness limit;
3. the time-weighted average of the valid midpoints is at or above the threshold.

Everything is integer arithmetic: prices and sizes in the market's smallest unit, times in
milliseconds, the average in micro price units, floored. The same samples always give the same
decision on any machine.

**Data source.** Samplers read Gemini's public WebSocket `wss://ws.gemini.com`, stream
`{symbol}@depth5`, which sends a full top-of-book snapshot every second even when nothing changes.
A sample's data time is when its snapshot arrived. (`@bookTicker` only sends on change, so a quiet
but valid book would look stale; the recorded Austin weather feed in the tests shows exactly that.)

## Parameters (PROVISIONAL)

Fixed at pot creation. The pot's `conditionId` is
`keccak256(abi.encode(engineVersion, instrumentSymbol, side, mode, params))`, so neither the market
contract, the side, the pot mode nor any parameter can change afterwards.

| | Demo template | Other templates |
|---|---|---|
| threshold | 85% | 85% |
| window | 60 s | 30 min |
| sample every | 2 s | 10 s |
| minimum valid samples | 25 | 150 |
| maximum spread | 0.04 | 0.05 |
| minimum size per side | 10 contracts | 50 contracts |
| maximum staleness | 10 s | 60 s |

These values are provisional and will be tuned against real order books (see PROGRESS.md).

## Evidence

Each signer samples independently and builds its own evidence record: engine version, chain ID,
vault, pot ID, conditionId, Gemini instrument symbol, side, pot mode, all parameters, window start
and end, every sample (sampling time, data time, best bid, best ask, both sizes, status), the valid
count, the time-weighted average, the decision code, the data source and the signer's address.

- Canonical form: the Solidity ABI encoding of that tuple, in that field order, integers only.
  `evidenceHash = keccak256(canonical bytes)`. A JSON view with every integer as a decimal string is
  published for people; it converts back to the identical bytes.
- Anyone can recompute: `verifyRecord` rejects a record unless the conditionId commits to its
  parameters, every sample's status follows from its own values, and the count, average and
  decision equal a fresh evaluation.
- Each signer whose own record triggers signs two things: the vault result in the existing format
  (EIP-712 `Resolution(potId, conditionId, outcome = true)`) and an EIP-712
  `TriggerAttestation(potId, conditionId, evidenceHash, averageMicro, windowStart, windowEnd)`,
  domain `HonorCat Trigger` / `1` / chain ID / vault.
- The relay accepts a submission only if the signer is one of the pot's resolver owners, appears
  once, the record is for this pot and passes `verifyRecord`, and both signatures recover to that
  signer. With at least the threshold of accepted signers (2 of 3), it concatenates their
  resolution signatures in ascending signer order (the format `MultisigResolver` checks) and
  computes `evidenceRoot = keccak256(abi.encode(bytes32[] evidenceHashes in ascending signer order))`.
  The payout memo carries the evidenceRoot; the proof page publishes every record and attestation.

**The vault does not verify evidence.** It only checks that the pot's resolver (the 2-of-3
`MultisigResolver`) signed `Resolution(potId, conditionId, true)`. The evidence makes every payout
decision auditable by anyone after the fact; it does not enforce it on-chain. A record also cannot
prove that its quotes really came from Gemini: what stops a single dishonest or faulty sampler is
that two independent signers on different hosts must each see the trigger in their own data.
