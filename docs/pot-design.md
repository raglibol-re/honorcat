# HonorCat pots: design (D0, 2026-11-16; decisions applied)

Design for the two-sided pot (spec sections 2 to 5). The user's decisions of 2026-11-16 are applied
throughout and listed in section 11.

## 0. Shape of the system

- **On-chain** (Arc testnet, new contract `HonorCatPots`): holds every pot's USDC, its state, the
  two positions (as ERC-721 tokens), exit requests, nets and bowls, claimable balances. It never
  reads a price itself; it accepts **attestations** signed by the pot's signer set (M of N) and
  checks them strictly. It moves money only on division, settlement, expiry and refunds.
- **Off-chain** (relay and the three samplers): each sampler reads Gemini's order book on its own
  (existing engine), computes window averages and signs attestations. The relay collects them and
  submits transactions, but **anyone** may submit a valid attestation; the relay is a convenience.
- **Signer set**: the existing `MultisigResolver` (2 of 3 samplers, `0x81d1…36c9`), checked through
  ERC-1271 `isValidSignature(digest, signatures)`. Each pot stores its resolver at creation and
  keeps it for life, so a later signer set can never change an existing pot.

## 1. Units and arithmetic

- **Money**: USDC through its ERC-20 interface, 6 decimals (Arc's native 18-decimal view is used only
  for gas; the relay's existing conversion stays). All amounts are `uint256` base units.
- **Price**: the YES probability in **ppm**, `p ∈ [0, P]` with `P = 1_000_000`. A NO-side price is
  `P − p`. Gemini prices have 2 decimals; window averages are finer, ppm keeps them without floats.
- **The one split function** used everywhere:

  ```
  yesPart(n, p) = floor(n · p / P)        noPart(n, p) = n − yesPart(n, p)
  ```

  Since `0 ≤ p ≤ P`, `0 ≤ yesPart ≤ n`, so `noPart ≥ 0`, and **`yesPart + noPart = n` exactly** for
  every `n` and `p`. Every division below is built from this, so no operation can lose or create a
  unit. `n · p` cannot overflow: `n < 2^128` (enforced by the cap) and `p ≤ 10^6`.
- **Fee**: `fee(n) = ceil(n · feeBps / 10_000)`, then capped at the payer's cash (see 3.3).
- Rounding direction, stated once: **YES rounds down, NO takes the remainder**; the fee rounds up
  (in favour of the side that stays). Both are fixed rules, not choices per call.

## 2. A pot

```
Pot {
  conditionId     // keccak(engineVersion, instrumentSymbol, rule params): which Gemini contract and rule
  resolver        // ERC-1271 signer set, fixed for life
  notional N      // current pot size (USDC units); shrinks on partial exits
  depYes, depNo   // current deposits backing each side; depYes + depNo = N always
  bandCenter q    // ppm, the creator's price; the entry price must land in [q − tolerance, q + tolerance]
  tolerance       // ppm, at most 5 points
  escrow[2]       // what each side paid in while Open/Joining (worst case of the band)
  closeTime       // Gemini trading close (from the market), seconds
  grace           // settlement grace, chosen at creation, at least 1 day (default 3 days)
  deadline        // closeTime + grace
  feeBps, window W, delay D, lockout L, cooldown   // copied from protocol defaults at creation
  state           // Open, Joining, Live, ExitRequested, Divided, Settled, Expired
  join { joiner, requestTime, nonce }
  exit { side, notional n', requestTime, nonce, taker, takerEscrow }
  net[2], bowl[2] // per side, ppm of that side's own price, 0 = unset
}
```

Positions: one ERC-721 token per side, `tokenId = potId · 2 + side` (side 0 = YES, 1 = NO). The
token owner **is** the side: whoever holds it may request an exit, set a net or bowl, sign a
handshake, and receives that side's payouts.

**Transfer rules.** (1) A transfer resets that side's net and bowl. (2) No transfer of the exiting
side's token while its exit window is open, except through a takeover (the contract moves it
itself). (3) Tokens are minted with `_mint` and moved with `transferFrom`, not `safeTransferFrom`
by the contract, so passkey accounts (which do not implement `onERC721Received`) can hold them; a
passkey account sends its token by calling `transferFrom` through its `execute`, and signs exits,
nets, bowls and handshakes with ERC-1271 (`isValidSignature`), which the contract accepts through
OpenZeppelin `SignatureChecker`. (4) Tokens stay after a pot ends (they record history) and carry no
value then.

## 3. State machine

```
            create (creator deposits)
                     |
                     v
   +-------------- OPEN ----------------------+ cancel (creator) / closeTime passed (anyone)
   |                 | requestJoin (joiner escrows   -> EXPIRED (creator refunded)
   |                 | its worst case in the band)
   |                 v
   |              JOINING --join failed / timed out--> back to OPEN (joiner refunded)
   |                 | entry price attested, inside the band
   |                 v
   |               LIVE <---------------------------------+-------------------------------+
   |   handshake /  |  requestExit / net / bowl            | exit failed or timed out      | partial exit done
   |   full exit    |                                      | (pot continues)               | (N shrinks)
   |                v                                      |                               |
   |          EXIT_REQUESTED ------------------------------+-------------------------------+
   |                | full exit priced (or takeover: back to LIVE with a new owner)
   v                v
 EXPIRED         DIVIDED           LIVE/EXIT_REQUESTED --settle (outcome attested)--> SETTLED
 (deposits       (all paid)        any non-terminal state --deadline passed (anyone)--> EXPIRED
  back)
```

Terminal states: **Divided, Settled, Expired**. Every non-terminal state has a permissionless,
time-based way out (`expire` after `deadline`, `cancel`/`expire` of an Open offer after
`closeTime`, `abandonExit` after the attestation timeout), so **no path strands funds**: whatever
happens to the signers or the relay, after `deadline` anyone can return every deposit.

### 3.1 Transitions

| From | Call | Who | Guards | Effect |
|---|---|---|---|---|
| — | `create(side, N, q, tolerance, grace, depth, auth)` | creator (or anyone with the creator's EIP-3009 authorization) | not paused; fresh **Depth** attestation for this market; `N ≤ min(globalMax, cap(depth))` (section 7); `tolerance ≤ 5 points`; `grace ≥ 1 day`; `now < closeTime − L` | pulls the creator's **worst case in the band** (YES: `yesPart(N, q + tol)`, NO: `noPart(N, q − tol)`); mints the creator's token; **Open** |
| Open | `requestJoin(auth)` | anyone except the creator | `now < closeTime − L` | pulls the joiner's worst case in the band; records `requestTime`, `nonce++`; **Joining** (binding for both) |
| Joining | `resolveJoin(attestation)` | anyone | **JoinPrice** attestation for this nonce, window `[requestTime + D, + W]`, `valid`, price inside the band | entry price `e`: `depYes = yesPart(N, e)`, `depNo = N − depYes`; each side refunded `escrow − dep`; mints the joiner's token; **Live** |
| Joining | `failJoin(attestation)` / `abandonJoin()` | anyone | `valid = false` or price outside the band / timeout passed | joiner refunded in full; **Open** again |
| Open | `cancel()` | creator; anyone after `closeTime` | — | refunds the creator; **Expired** |
| Live | `requestExit(side, n', sig?)` | side owner, or anyone with the owner's EIP-712 `ExitRequest` signature (gasless, EOA or ERC-1271 passkey account) | `1 ≤ n' ≤ N`; `now < closeTime − L`; no pending exit; cooldown passed | records `requestTime = now`, `nonce++`; **ExitRequested** (binding: no withdraw function exists) |
| Live | `triggerNet / triggerBowl(side, attestation)` | anyone | valid **Threshold** attestation that the side's own price held beyond its net/bowl | same as `requestExit` for the full notional |
| ExitRequested | `resolveExit(attestation)` | anyone | valid **ExitPrice** attestation for this pot, this `nonce`, `windowStart = requestTime + D`, `windowEnd = windowStart + W`, `valid = true` | divides `n'` at the attested price (3.3); full exit: **Divided**; partial: **Live** with `N −= n'` |
| ExitRequested | `failExit(attestation)` | anyone | **ExitPrice** with `valid = false` (too few valid samples, market halted, under review or failing the rule) | **Live**, nothing moves, cooldown starts |
| ExitRequested | `abandonExit()` | anyone | `now > requestTime + D + W + attestTimeout` | **Live**, nothing moves, taker refunded |
| ExitRequested | `takeover(auth)` | a third party | full exit (`n' = N`), no taker yet, window not ended | escrows `N` from the taker (3.5) |
| Live | `handshake(price, n', sigYes, sigNo)` | anyone | both owners signed `Handshake(potId, price, n', nonce, deadline)` | divides `n'` at `price`, **no fee**; **Divided** or **Live** |
| Live, ExitRequested | `settle(attestation)` | anyone | **Outcome** attestation, `now ≥ closeTime` | YES or NO outcome: winner gets `N`, **Settled**; void: deposits back, **Expired**; a pending exit is dropped, a taker refunded |
| any non-terminal | `expire()` | anyone | `now ≥ deadline` | deposits back (`depYes`, `depNo`), taker refunded; **Expired** |

`pause()` (owner) blocks only `create`. Every other function works while paused.

### 3.2 Creation and joining (forward-priced)

A join is priced like an exit, so a joiner cannot pick a moment when the offer is stale: the joiner
requests, the entry price `e` is the average of the window after the request, and the join fails if
`e` leaves the creator's band `[q − tol, q + tol]`.

- **Escrows**: `yesPart` grows with the price and `noPart` falls, so the most YES can owe in the band
  is `yesPart(N, q + tol)` and the most NO can owe is `noPart(N, q − tol)` (prices clamped to
  `[0, P]`). The creator escrows its side's worst case at `create`, the joiner its side's at
  `requestJoin`.
- **Settling the entry**: `depYes = yesPart(N, e)`, `depNo = N − depYes`. Because `e` is inside the
  band and the split is monotonic, `depYes ≤ escrowYes` and `depNo ≤ escrowNo`, so both refunds
  `escrow − dep` are ≥ 0, and the pot keeps exactly `depYes + depNo = N`.
- Deposits are pulled with Arc USDC's EIP-3009 `receiveWithAuthorization` (payee = the contract,
  nonce bound to the call's parameters), so users pay no gas; the relay submits each step as one
  transaction.
- **A simpler alternative considered**: dropping the band and letting the joiner enter at whatever
  the forward price is would need both sides to escrow up to `N` and would let the price move
  against the creator without limit. The band keeps escrows small and gives the creator a bound;
  the cost is one extra state (`Joining`). I see no simpler way that closes the gap.

### 3.3 Division (exit of n' at price p by side s)

```
cashYes = yesPart(n', p)        cashNo = n' − cashYes            // sums to n'
fee     = min(ceil(n' · feeBps / 10_000), cash_s)                 // never more than the exiter has
pay(exiter) = cash_s − fee      pay(other) = cash_other + fee     // sums to n'
depYes' = depYes − floor(depYes · n' / N)    N' = N − n'    depNo' = N' − depYes'
```

**Proof that nothing is lost or created.** (a) `cashYes + cashNo = n'` by the split function.
(b) `pay(exiter) + pay(other) = cash_s − fee + cash_other + fee = n'`, and both are ≥ 0 because
`fee ≤ cash_s`. (c) After the division the contract holds `N − n' = N'` for this pot, and
`depYes' + depNo' = N'` by definition. (d) `0 ≤ depYes' ≤ N'`: `depYes' ≥ depYes − depYes·n'/N =
depYes·N'/N ≥ 0`; and if `depYes < N` then `depYes·N'/N < N'`, so the integer `depYes'`, which is
less than `depYes·N'/N + 1`, is at most `N'`; if `depYes = N` then `depYes' = N − n' = N'`. Hence
`depNo' ≥ 0`. Repeated partial exits (nine lives: `n' = floor(N·k/9)` of the current `N`) apply
the same step each time, so their total also sums exactly; the last ninth takes whatever remains.

### 3.4 Settlement and expiry

- Outcome YES: the YES owner receives `N`; NO: the NO owner receives `N`. One transfer, sums to `N`.
- Void, or no settlement by `deadline`: YES receives `depYes`, NO receives `depNo`; sums to `N`.
- Open offer cancelled or expired: the creator receives their deposit (the only money in the pot).

### 3.5 Takeover

While a **full** exit window is open, a third party may take the exiting side's place. The taker
escrows `N` (the most the exiting side can be worth). When the exit price `p` is attested:
`cash_s = yesPart/noPart(N, p)`; the exiter receives `cash_s − fee`, the other side receives `fee`,
the taker is refunded `N − cash_s`, and the exiting token is transferred to the taker. The pot stays
**Live** with the same `N` and deposits. Money in: `N` (escrow). Money out:
`(cash_s − fee) + fee + (N − cash_s) = N`. One taker per window; the first valid call wins.

### 3.6 Handshake

Both owners sign `Handshake(potId, price, n', nonce, deadline)` (EIP-712, EOA or ERC-1271). The pot
divides `n'` at `price` with **no fee** (3.3 with `fee = 0`). No oracle is needed because both
sides consent; the UI proposes the current smoothed price.

### 3.7 Net and bowl

A side stores a net (floor) or bowl (target) on its own price, in ppm. Anyone may submit a
**Threshold** attestation that the smoothed price of that side held at or below its net (or at or
above its bowl) for the engine's threshold window; the contract then files a full exit request for
that side exactly as `requestExit` would. The exit is then priced forward like any other. Nets and
bowls are cleared when the token is transferred.

### 3.8 Claimable balances

Every payout is a USDC `transfer` wrapped in try/catch. If it fails (for example a blocklisted
recipient), the amount is credited to `claimable[recipient]` and can be withdrawn later by that
address (the existing vault pattern). State changes happen before transfers; reentrancy-guarded.

### 3.9 Contract-level invariant

`USDC.balanceOf(this) = Σ_{non-terminal pots} N + Σ open-offer deposits + Σ taker escrows +
Σ claimable`. Every function keeps it; the invariant tests check it after every call sequence.

## 4. Attestations

EIP-712 domain `HonorCatPots` / `1` / chain ID / contract address. Every type includes `potId`
(or the market and the account for quotes), so a signature is bound to chain, contract and pot.

| Type | Fields | Used by | Replay protection |
|---|---|---|---|
| `Depth` | `conditionId, account, contracts5c (hundredths of a contract), validUntil` | `create` (cap) | short `validUntil` (60 s); bound to the creator |
| `JoinPrice` | as `ExitPrice`, kind = join | `resolveJoin`, `failJoin` | the join `nonce` |
| `ExitPrice` | `potId, nonce, side, notional, windowStart, windowEnd, sampleCount, priceYes, valid, evidenceHash` | `resolveExit`, `failExit`, takeover settlement | `nonce` must equal the pending exit's; consumed by the state change |
| `Threshold` | `potId, side, kind (net/bowl), level, windowStart, windowEnd, sampleCount, evidenceHash` | `triggerNet`, `triggerBowl` | `windowEnd` must be after the net/bowl was set and the last exit; one request per trigger |
| `Outcome` | `potId, conditionId, outcome (yes/no/void), settledAt, evidenceHash` | `settle` | terminal state change |

**Checks on-chain**: `resolver.isValidSignature(digest, sigs) == 0x1626ba7e` (M distinct owners,
ascending, exactly M signatures); for ExitPrice: `windowStart == requestTime + D`,
`windowEnd − windowStart == W`, `windowEnd ≤ block.timestamp`, `sampleCount ≥ minValid`, the side and
notional match the request; for Quote: `block.timestamp ≤ validUntil`; for Outcome:
`block.timestamp ≥ closeTime`. The window is fixed by the request, so **signers cannot choose a
window**.

**How M signers agree on one price** (decided): each sampler first signs its own window average
(inside its evidence record). The proposed price must be the **exact median** of those signed
averages (with only two samplers: their mean, and they must be within 0.5 points of each other).
Each sampler co-signs the proposal only if it is within 0.5 points of its own average. All signed
averages go into the evidence record, so anyone can check that the relay had no discretion. If
agreement fails, no attestation exists and the exit (or join) does not happen. The attestation's
`evidenceHash` is the root of the samplers' evidence records.

**Fair value read**: `fairValue(tokenId, ExitPrice or Quote attestation) → USDC` returns that
side's share of `N` at the attested price after verifying the signatures (a `view`, no state).
Other contracts can price a position without trusting HonorCat.

## 5. Prices and evidence

- **Sample**: the midpoint of best bid and ask from `{symbol}@depth5`, valid only under the rule
  (both sides present, spread and size within limits, data fresh): the existing engine and status
  codes.
- **Smoothed price** (for showing shares, nets and bowls): the time-weighted average of valid samples
  over the last 30 s, per sampler. Not used for joins: joins are priced forward like exits.
- **Exit price**: the time-weighted average of valid samples in `[requestTime + D, requestTime + D +
  W]`. Only samples whose sampling time is strictly after `requestTime` count; with `D = 1 s` and
  second-resolution block timestamps, nothing observed before the request can enter.
- **Never settle on bad data**: fewer than `minValid` valid samples, the market not `open` at any
  point in the window (Gemini `marketState`), or the contract under review → samplers sign
  `valid = false`; the pot continues.
- **Evidence record** per sampler and attestation: the existing deterministic record (samples,
  times, statuses, average), extended with `kind` (exit, threshold, quote, outcome), `potId`,
  `nonce` and `requestTime`. Public pages show hash and computed values; the two owners see the
  raw samples after signing in (the existing session mechanism).

## 6. What each sponsor does in this design

- **Arc**: USDC only, gas included; EIP-3009 deposits; create-and-fund and resolve-and-pay as one
  transaction each through Multicall3From (`0x522f…47D0`); every payout's reason (exit price, window,
  evidence hash) attached with Memo (`0x5294…e505`); time from attestation signature to payout
  receipt measured by the relay and shown.
- **Gemini**: market list and quality ranking, live midpoint for shares, forward-window average for
  exits, `marketState` gating exits, `resolutionSide` ending pots, depth as the basis of the cap.
- **QuickNode**: a Streams filter on `HonorCatPots` events (`PotCreated`, `SideJoined`,
  `ExitRequested`, `ExitPriced`, `ExitFailed`, `PotDivided`, `Handshake`, `Takeover`, `NetSet`,
  `BowlSet`, `PotSettled`, `PotExpired`, `Transfer`) as the primary feed; RPC polling as fallback;
  each event row records which path delivered it and the delay; backfill by replaying the stream's
  block range after downtime.

## 7. Cap on N

Rule: `N ≤ min($25 testnet maximum, 0.25 × C₅)`, where `C₅` is the number of contracts resting within
5¢ of the mid on the **thinner** side (attested at creation), each contract paying $1. The multiple
comes from the arithmetic in docs/threat-model.md ("Manipulating an exit price"): moving the price by
5 points and holding it through the window must cost at least twice what the attacker can gain on
the pot. With Gemini's fees included, the requirement gives `N ≤ C₅ · (0.25 + 1.4·P(1−P))`; at the
worst price (`P` near 0 or 1) the factor is 0.25, at `P = 0.5` it is 0.6. A fixed 0.25 meets the
requirement at every price. Examples from today's catalogue: a liquid BTC contract with about 1,000
contracts near the price → cap $25 (testnet maximum); a weather contract with 100 → cap $25; a thin
one with 40 → cap $10.

## 8. Tests (D1)

- **Unit**: every transition and guard in 3.1, every attestation check (wrong signer, too few
  signers, unsorted, wrong pot, wrong nonce, wrong window, stale quote, expired authorization).
- **Fuzz**: the split function and division for random `N, n', p, feeBps` (sums exact, nothing
  negative); deposits after repeated partial exits.
- **Invariants** (stateful fuzzing over random call sequences): the balance equation in 3.9; no pot
  divided twice; no division without a valid attestation; no exit request in lock-out; terminal
  states never change; every pot can reach a terminal state by `deadline`.
- **Symbolic** (if halmos runs in our setup): `yesPart + noPart = n` for all inputs, division
  conservation, deposit bounds. If it does not run, the paper proofs above stand and the doc says
  so.
- **Scenario tests from the spec**: stale-price exit priced after the jump; a short spike barely
  moves the exit price; exit refused in lock-out, on a failing market, without enough samples;
  ninths never lose a cent; handshake, takeover, net, bowl, expiry.
- **What is proven vs tested** will be stated per property in the D1 notes: arithmetic identities
  proven (paper, plus symbolic if available); state-machine properties tested by invariants, not
  proven.

## 9. Threat model additions

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

## 10. Defaults (spec section 11) and my view

| Default | Spec | My view |
|---|---|---|
| Exit window | 60 s (demo markets 20 s) | Keep 60 s and 20 s. With a sample every 2 s that is 30 and 10 samples; require 80% valid (24 and 8). Longer windows resist spikes better but delay the exit. |
| Fee | 1% of the exited notional | Keep 1%. It is also the cost of griefing. A handshake has no fee. |
| Lock-out | last 2 minutes before trading closes | Use `max(2 min, D + W + 60 s)` so no window can run past the close. Same as 2 min for both window lengths today. |
| Join tolerance | 2 points | Keep 2 points as the default, cap creator choices at 5 points. |

## 12. D1 results (2026-11-16)

Contract: `contracts/src/HonorCatPots.sol`, deployed on Arc testnet at
`0xc890C990048f45cb268d076E4A3dB25270Ea1e59` (block 72496233), 23.3 KB of the 24 KB limit
(compiled with `via_ir`). Built in the agreed order with tests green after each step: core
(create, forward-priced join, exit, settle, expire) → cap → partial exit → handshake → nets and bowls
→ takeover.

Tests (`forge test`, 77 in total, 62 for the pots):

| Suite | What |
|---|---|
| `HonorCatPots.t.sol` (34) | every transition and guard of the core and the cap: escrows, band, window fixed by the request, too-early and too-few-samples, single-signer and outsider signatures, replay, lock-out, cooldown, abandon, token lock during the window, gasless exit by signature, settle, void, expire, blocked recipient → claimable, EIP-3009 authorization bound to the action |
| `HonorCatPotsPartial.t.sol` (4) | partial exits, nine lives in ninths, fuzzed partial exits |
| `HonorCatPotsHandshake.t.sol` (4) | no fee, partial, both signatures needed, no replay |
| `HonorCatPotsLevels.t.sol` (6) | net and bowl triggers on each side's own price, window after setting, reset on transfer |
| `HonorCatPotsTakeover.t.sol` (6) | payouts, one per window, full exits only, refunds on failure, settle and expire, levels reset |
| `invariant/PotsInvariants.t.sol` (4 invariants, 128 runs × 200 calls) | the balance equation (3.9), deposits sum to N, terminal states final, USDC supply conserved, over random sequences of every action with real 2-of-3 signatures |
| `symbolic/PotsMath.t.sol` | the split, the division and the band escrows on the contract's own pure arithmetic: as fuzz tests, and as halmos `check_` functions |

**What is proven and what is only tested**

- *Proven on paper* (section 3.3): the split sums exactly; every division, partial exit, takeover,
  settlement and expiry pays out exactly what goes in; deposits stay within the pot.
- *Symbolic execution (halmos 0.3.3)*: all three checks (`check_split`, `check_divide`,
  `check_bandEscrowCovers`) ran on the contract's own arithmetic and **timed out** after 120 s each
  without a counterexample. The SMT solver does not settle 256-bit non-linear multiplication and
  division in that time. So these are **not machine-proven**: they rest on the paper proofs above and
  on fuzz tests (`testFuzz_split`, `testFuzz_divide`, `testFuzz_partialConservation`).
- *Tested, not proven*: every state-machine property (balance equation, terminal states, no division
  without an attestation, no exit in lock-out) by unit tests and stateful invariants. A different
  sequence of calls than the fuzzer tried could, in principle, break them; none has.
- *Not tested here*: the samplers' price agreement and the forward-window averages (D2, relay).

Static analysis: Slither, 35 findings, all reviewed in `contracts/slither-triage.json` (timestamps as
the protocol clock, reentrancy findings on `nonReentrant` functions that call only Arc USDC, the
low-level call of the claimable pattern). Two findings were fixed instead (admin events, explicit
initialisation).

## 13. D2 to D5 results (2026-11-16)

- **Relay (D2).** A pot entering Joining or ExitRequested opens a window request
  `w:<pot>:<nonce>:<kind>` for exactly `[request + 1 s, + window]`. Each sampler builds its own
  evidence record (the trigger engine's canonical record, rule committed in the conditionId) and
  signs its hash; the relay verifies the record and takes the median of three (mean of two within
  0.5 points; otherwise `valid = false`). Each sampler co-signs only within 0.5 points of its own
  average. Two co-signatures: the relay submits (anyone could). Depth and outcome requests use the
  same tables. Nets and bowls: a sampler that sees a side's own average hold beyond its level asks
  for that window; the others measure the same seconds.
- **Timing found in the runs.** Arc's `block.timestamp` trails the wall clock by a few seconds, so
  a window could be submitted before the chain considered it ended (`TooEarly`). The relay now waits
  for the chain clock and retries such failures.
- **Quotes and fair value (D5).** Kind 6 (QUOTE) windows are measured and signed like exit prices,
  but HonorCatPots accepts only kinds 0 to 5, so a quote can never move money. HonorCatFairValue
  (stateless, 0x8a89...71a5) checks a quote against the pot's own signer set and freshness and returns
  a side's share and exit fee. Verified on-chain for pot 2.
- **Runs against production.** Exit (pot 3), takeover (4), handshake (5), bowl (6), held to
  settlement (7, Gemini settled YES), quote (2): `relay/scripts/pots-e2e.ts`, `pots-quote.ts`.

## 11. Decisions (user, 2026-11-16)

1. Price agreement: each sampler signs its own window average; the proposal is the exact median of
   the signed averages (two samplers: their mean, within 0.5 points); each sampler co-signs only
   within 0.5 points of its own; all signed averages in the evidence. No agreement, no exit.
2. Cap: chosen by the cost arithmetic (section 7 and the threat model): 0.25 × thinner-side
   contracts within 5¢, with the $25 testnet maximum.
3. Settlement grace: per pot, fixed at creation, default 3 days, minimum 1 day.
4. Takeover only for full exits.
5. 30-second smoothing for shown shares, nets and bowls. Joins are forward-priced (3.2).
6. Positions as ERC-721, one per side, with the transfer rules in section 2.
7. D1 builds every contract feature, in this order with tests green after each: create, join, exit,
   settle, expire; cap; partial exit; handshake; nets and bowls; takeover. An early core deployment
   to testnet may be used as a throwaway; only the final deployment counts.
