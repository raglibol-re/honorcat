# HonorCat v2: short ropes and treats — design note (R0, 2026-11-18)

Step 1 of the v2 spec. It describes one new contract (working name `HonorCatRopes`) for normal pots,
short ropes (leverage) and fee-based treats, and lists the open decisions from spec sections 3, 6
and 7, each with a proposal. **Nothing is built until you answer section 9.** The existing
`HonorCatPots` (0xc890…1e59) and its pots stay untouched.

## 1. Units, the split rule and rounding

- Prices in ppm of the YES probability, `P = 1_000_000` (as today). Posts `L < q < U`, all in ppm.
- `N` is the notional in USDC base units per full price range (one contract = $1 at `P`). A normal
  pot (`L = 0`, `U = P`) holds `N`, exactly as today.
- **Pot total** `T = floor((U − L) · N / P)`.
- **YES share at price p**: `Y(p) = floor((clamp(p, L, U) − L) · N / P)`. **NO share**: `T − Y(p)`.
- Deposits are `Y(q)` for YES and `T − Y(q)` for NO.

Rounding rule, stated once: **YES rounds down, NO takes the remainder** (as today). Because
`clamp(p) ≤ U`, `Y(p) ≤ T`, so the NO share is never negative and **the two shares sum to `T`
exactly at every price**, including any jump far beyond a post. Every exit, partial exit, takeover,
knock-out, expiry and settlement is built from `Y`, so none can create or lose a unit. The fee rule
(ceil, capped at the payer's cash) and the partial-exit deposit rule (`dep' = dep − floor(dep·n'/N)`)
carry over from docs/pot-design.md 3.3 unchanged; the paper proof there applies with `T` in place of
`N`.

Leverage shown: YES `q / (q − L)`, NO `(P − q) / (U − q)`.

**No debt, by construction**: the contract only ever pays out of `T`, which is fully deposited, and
`0 ≤ Y(p) ≤ T` for all `p`. So no side can lose more than its deposit and nothing is ever owed. This
is the invariant `paidYes + paidNo + fees = deposits` per pot, tested by fuzz and stateful invariants
(and symbolically if halmos finishes; it timed out on the 256-bit products last time).

### 1.1 Posts are set at the join, relative to the entry price (proposal)

Joins are forward-priced: the entry price `e` lands somewhere in the creator's band `q ± tol`. If the
posts were absolute, leverage and both deposits would change with `e`. Proposal: the creator chooses
**distances** `dY = q − L` and `dN = U − q`; at the join the contract sets `L = e − dY`, `U = e + dN`.

- Deposits are then exactly `dY·N/P` and `dN·N/P` whatever `e` is: no band escrow, no refunds, one
  fewer thing to explain.
- Creation requires `q − tol − dY ≥ 0` and `q + tol + dN ≤ P`, so the posts can never fall outside
  `[0, P]`.
- Normal pots (`L = 0`, `U = P`) keep today's band escrow and refund, because there the posts are the
  ends of the range.

## 2. Knock-out

- A post is reached when the **smoothed price holds at or beyond it for one threshold window** (the
  net/bowl logic and attestation, kinds reused with a new `KIND_KNOCK`). Anyone may submit it.
- The trigger files a binding **forward window** `[trigger + 1 s, + W]`, priced like every exit. The
  pot is then divided at the clamped window average **and ends**, also when that average is back
  inside the posts.
- **No exit fee on a knock-out** (nobody chose to leave). Proposal; see decision D7.
- Not allowed while another window is open or inside the lock-out (a knock-out after expiry is
  impossible anyway, see 3).

## 3. Short ropes always end before resolution (spec section 3)

Every pot with `L > 0` or `U < P` has an expiry `X`, fixed at creation.

- At `X` the pot is divided at the forward-priced, clamped average of the window `[X + 1 s, + W]`.
  **The window is fixed by `X`, not by whoever calls**, so nobody can choose it and it cannot be
  skipped: samplers measure it on their own, anyone submits it, and every other action (exit,
  extra life, takeover) is refused from `X` on.
- If a window is open at `X`, it finishes first; expiry follows.
- If the market settles before any division, settlement counts as price `0` or `P`, then clamped.
- Normal pots keep today's behaviour and may run to settlement.

**Proposed values (D1).** I will check them against the backtest (step 3) before the contract is
final, and change them if it says so.

| | Proposal | Why |
|---|---|---|
| Lead before trading close | **2 hours** (`X ≤ close − 2 h`) | Prices of short markets (5-minute, hourly crypto, same-day weather) converge to 0 or 100 in their last hours; that is where overshoot is largest. It also excludes markets that close in under about 2 hours from short ropes. |
| Maximum life | **7 days** | Long enough for daily weather and crypto and for a Fed market slice; short enough that the knock-out bias stays small (simulation in step 3). |
| Minimum life | **10 minutes** | Below that, two windows (trigger and price) and the lock-out leave no room to play. |

**If no valid expiry price comes (D2).** Proposal: up to three further windows, each starting
`W + 60 s` after the previous one (fixed by `X`, so still not choosable). If none is valid, the pot
waits for settlement (clamped), and if that never comes, `expire()` after the deadline returns the
deposits, as today. Funds can never be stranded.

## 4. Extra lives (spec section 4)

A side adds funds to move **its own** post further out: YES lowers `L` by `δ` and pays `δ·N/P`; NO
raises `U` by `δ` and pays `δ·N/P`. Check: after YES lowers `L` to `L'`, NO's share is
`T' − Y'(p) = (U − L')N/P − (p − L')N/P = (U − p)N/P`, unchanged for every `p` inside the old posts
and larger for `p` in `[L', L)`. So **an extra life never reduces the other side's claim**. Allowed
any time the pot is Live, with no window open, not in the lock-out and before `X`.

**Proposal (D3)**: one extra life moves the post by exactly the pot's original distance on that side
(`dY` or `dN`), up to **8 extra lives** (a cat has nine), and never past `0` or `P`. Fixed steps make
the paw marks meaningful ("2 extra lives left") and the leverage after each life easy to say. The
alternative is any amount, which is more flexible but harder to show.

## 5. What carries over

Voluntary exit, partial exit, handshake, takeover (the taker escrows `T`, the most a side can be
worth), nets and bowls, gasless signatures and EIP-3009 deposits all work as today with `Y(p)` in
place of `yesPart(N, p)`. Positions stay ERC-721 and transferable; copy marks and extra lives belong
to the token, not the account.

## 6. Limits (spec section 6)

### 6.1 Cap on N: the arithmetic with Gemini's current fees

**Gemini's fee schedule** (contracts listed from 2026-03-18, checked today on gemini.com/fees/predictions):
taker `0.07 · C · P(1 − P)`, maker `0.0175 · C · P(1 − P)`, maker fees **waived until 2026-12-31**
(promotion), no settlement fee. An attacker who pushes the price takes liquidity, so the taker rate
applies; the maker promotion does not lower the attack cost.

**Gain.** An attacker owning the side that wins at a post moves the price from `q` to that post
(distance `Δ`, in dollars) and holds it through the trigger window, the 1 s delay and the price
window. Its share rises by at most `Δ · N` (the clamp stops anything beyond).

**Cost**, buying the `D` contracts resting between `q` and the post on the side it pushes against:
- walking the book: on average `Δ/2` above fair per contract if depth is spread evenly;
- unwinding: when the price returns, that overpayment is lost (counted once, the conservative reading);
- taker fees on the way in and out: `0.14 · P̄(1 − P̄)` per contract, `P̄` the price along the path.

Requirement `cost ≥ 2 · gain`:

```
D · (Δ/2 + 0.14·P̄(1−P̄)) ≥ 2 · N · Δ    ⇔    N ≤ D · (1/4 + 0.07·P̄(1−P̄)/Δ)
```

| `P̄` \ `Δ` | 5 points | 10 points | 20 points |
|---|---|---|---|
| 0.50 | 0.60 · D | 0.425 · D | 0.34 · D |
| 0.80 | 0.47 · D | 0.36 · D | 0.31 · D |
| 0.95 | 0.32 · D | 0.28 · D | 0.27 · D |
| → 0 or 1 | 0.25 · D | 0.25 · D | 0.25 · D |

**So your estimate of `N ≤ 0.5 · D` holds only near 50% and with posts within about 7 points.** Over
all prices and distances the safe constant is **0.25**.

The weak spot is the "evenly spread" assumption: if nearly all depth sits right at `q`, walking the
book costs almost nothing and only fees remain, and the cap above is too generous (by up to about
3× at 50%). **Proposal (D4)**: instead of a contract count, the signers attest, for each post, the
**actual cost to walk the full book from the mid to that post** on the side that would be pushed
against (`Σ size_i · (price_i − mid)` plus taker fees, from Gemini's full `/v1/book`, not only the
five-level `depth5`). The contract enforces, for each post,

```
2 · N · Δ_post ≤ attestedCost_post        and        T ≤ testnet maximum ($25)
```

This removes the even-spread assumption, needs no price-dependent constant on-chain, and checks
both posts, so the cheaper one binds whichever is nearer. If you prefer the simpler rule, the
fallback is `N ≤ 0.25 · D` with `D` the thinner side's contracts between `q` and the nearer post.

**What it means in practice** (medians from docs/market-quality.md): weather has about $8 within 5¢
on the thin side, so roughly 16 contracts, attack cost about $1, `N` at most about 10 contracts, and
**a 10-point rope on weather holds about $1**. Liquid BTC dailies (about $170 within 5¢) allow the $25
testnet maximum. Short ropes will in effect be a crypto-market product until books deepen. I'd
rather say that plainly in the UI than loosen the cap.

### 6.2 Minimum distance and maximum leverage (D5)

| Rule | Proposal | Why |
|---|---|---|
| Minimum distance from `q` to each post | `max(5 points, 2 × the attested spread)` | Below the spread, ordinary quote noise knocks a pot out. Median spreads are 2–4¢ in crypto and 5¢ in weather (market-quality.md), so this gives 5 points in crypto and about 10 in weather. The spread goes into the same depth attestation. |
| Maximum leverage, either side | **10×** for crypto markets, **5×** elsewhere | At `q = 50`, 10× is a 5-point post. Weather and politics books go one-sided often and jump on news; 5× there. The category is attested with the depth. |
| Testnet maximum | `T ≤ $25` (unchanged) | |

Per-market values are possible (the attestation carries spread and category); I would not go finer
than per category until the backtest shows a difference.

## 7. Treats (spec section 7)

Principle: every treat is a share of a fee someone actually paid; nothing is minted; no pool.
**No fee goes to the operator: there is no operator recipient in the code at all, and every rate is
an `immutable` set at deploy.** The owner can only pause new pots and lower the testnet maximum.
(Today's `setFeeBps` disappears in v2.) The UI will say "Nothing goes to HonorCat" and link to the
constants on the explorer.

### 7.1 Rates (D6)

| Treat | Your starting point | Proposal | Note |
|---|---|---|---|
| Maker treat | 0.25% of the joiner's deposit | **keep 0.25%**, paid on top of the deposit | On a 10× rope the deposit is small, so the treat is small; fine. |
| Exit fee | 1% | **1% of the exited notional `n'`** (as today), not of `T` | 1% of `T` on a long rope would be up to 10% of a 10× side's deposit. 1% of `n'` is "1 cent per contract", identical to today for normal pots. |
| Referral | 20% of fees for the first 20 pots | **keep 20%, first 20 pots** | See the farming note below. |
| Copycat treat | 5% of profit | **keep 5%** | |
| Knock-out / expiry fee | — | **none** (D7) | Nobody chose to leave. |

### 7.2 Why none of it can be farmed, and the one honest exception

- **Maker treat to oneself**: creating with one account and joining with another just moves your own
  money between your accounts. Zero-sum.
- **Copycat on oneself**: the leader's treat comes out of the copier's own profit. Same person: no gain.
  No profit: no treat (the contract checks).
- **Self-referral**: the contract rejects `referrer == self`, and a referrer can be set only once,
  before the account's first pot.
- **Sybil referral (the exception)**: passkey accounts are free, so a player can make a new account,
  refer it from their main one, and get 20% of their own fees back for 20 pots. That never creates
  money; it is a **20% fee discount paid by the counterparty**, who receives 80% of the fee instead of
  100%. I propose to state this in the README rather than pretend it cannot happen. If you prefer to
  close it, D8 lists the options.

### 7.3 Mechanics

- **Referral**: `setReferrer(ref)` once, only if the account has never been in a pot, `ref ≠ self`.
  The contract counts pots per account; for the first 20, 20% of every fee it pays (maker treat, exit
  fee, copycat treat) goes to the referrer and the rest to the normal recipient. Rounding: the
  referrer's share rounds down, the normal recipient takes the remainder.
- **Copycat**: a pot (side) can be created or joined `copyOf(potId, side)`; the leader is the owner
  of that side's token at that moment, fixed for life, and shown before confirming. Profit is tracked
  **per token**: `paidIn` (deposit, extra lives, maker treat) and `paidOut`. On each payout the treat
  is 5% of the profit above the previous high-water mark, so partial exits and transfers are handled
  exactly and a profit is never taxed twice.
- **Events**: `MakerTreat`, `ReferralTreat`, `CopycatTreat`, `ExitFee` (payer, recipient, amount, pot),
  for the indexer.
- **Conservation with fees**: per pot, `Σ payouts + Σ treats = Σ deposits + Σ fees paid`, tested.

## 8. Evidence (spec section 8): data reality check

The fairness math is right: with the price a martingale and `p*` the division price,
`E[clamp(p*, L, U)] = q − E[(p* − U)⁺] + E[(L − p*)⁺]`, so the fair YES deposit per unit is
`(q − L) − E[overshoot above U] + E[overshoot below L]`. Overshoot is measured at the **division**
price (the window average), which is what the backtest will use.

**The recorded data is thin for this.** `early_samples` (production) held about 23,600 samples at the last count (docs/market-quality.md), but
only during the windows of real pots, mostly 60 s to 30 min long, and on short crypto markets
up to 99% invalid (docs/market-quality.md). That is not enough continuous price paths to measure
"which post first" over hours. Proposal (D9):

1. Use the recorded samples where they exist (needs read-only access to the production database;
   the permission check stopped me today, see D10).
2. **Start recording now**: a small job (inside the existing sampler) that stores a 10 s mid for
   every contract that passes the book rule. Two days to the deadline gives about 48 hours of paths.
3. **For crypto strike markets**, reconstruct long price paths from Gemini's public BTC/ETH/SOL candles
   (months of data) with a standard digital-option model, and backtest on those. Labelled clearly
   as model-based, not market-observed.
4. The simulation (small moves plus jumps) as the spec asks, on top.

## 9. Decisions I need from you

| # | Question | My proposal |
|---|---|---|
| D1 | Expiry lead and maximum life | lead 2 h before close, maximum life 7 days, minimum 10 min; revisited after the backtest |
| D2 | No valid expiry price | three more fixed windows, then clamped settlement, then deposits back at the deadline |
| D3 | Size of an extra life | one original distance per life, up to 8 extra lives |
| D4 | Cap rule | signers attest the cost to walk the book to each post; contract enforces `2·N·Δ ≤ cost` per post, `T ≤ $25`. Fallback: `N ≤ 0.25 · D` |
| D5 | Minimum distance and maximum leverage | `max(5 pts, 2 × spread)`; 10× crypto, 5× others |
| D6 | Rates | maker 0.25% of deposit; exit fee 1% of `n'`; referral 20% for 20 pots; copycat 5% of profit |
| D7 | Fee on knock-out and expiry | none |
| D8 | Sybil referral | accept and state it. Alternatives: referral only after the referred account has paid at least $X of fees to someone else, or 10% instead of 20% |
| D9 | Backtest data | recorded samples + a 10 s recorder from today + model-based crypto paths, each labelled |
| D10 | Production database | may I run small read-only queries on the production database (`DATABASE_URL_PROD`) for the backtest? |
| D11 | Posts set at the join, relative to the entry price (1.1) | yes |

## 10. Things you should know before saying go

- **Contract size.** `HonorCatPots` is 23.3 KB of the 24 KB limit already. v2 adds posts, expiry,
  knock-out, extra lives and four treats, so it will not fit in one contract. Plan: the pot logic in
  `HonorCatRopes`, the split, cap and fee math in an external library, and referrals and copy
  tracking in the same contract only if they fit; otherwise a small `HonorCatTreats` ledger that only
  the pots contract can write to. Funds stay in one contract either way.
- **Signers.** The samplers need three new measurements: knock-out thresholds against posts, the
  fixed expiry window, and the cost-to-post depth. The MedianResolver rule carries over.
- **Time.** The hackathon deadline is 2026-11-20, two days from now. All six steps with full tests
  and end-to-end runs is more than two days of careful work. If the deadline matters for v2, my
  suggested cut is: contract with tests, the knock-out and expiry relay, and the create page and rope
  view, deployed to testnet; treats UI, cosmetics, the weekly table and the full backtest after.
  Tell me if you want that cut or the full order regardless of the date.
