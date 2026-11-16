# Rubric: HonorCat, money in the air

Every item is checked only with evidence (a test name, a transaction, a page, a command and its
output). Order follows the spec's sections. Milestones: C0, C1, D0 to D5.

## 1. One product, a readable repository (C0, C1)
- [x] Inventory of every route, page, component, API, relay job, contract, script, table, variable
      and doc, marked keep/rework/remove (docs/cleanup-plan.md).
- [x] Retired products take no new pots; their open pots stay readable and keep settling.
- [x] Retired contracts listed in the README with addresses and purpose; sources in contracts/archive.
- [x] One name everywhere (HonorCat); retired contracts keep their on-chain names.
- [x] One market picker, one Gemini order-book reader, one module for rule constants, demo market
      choice from the catalogue.
- [x] Old `pots` table renamed to `vault_pots` by one migration with a rollback; row counts equal
      before and after; old pots still settle afterwards.
- [x] Environment variables switched to the new names in Vercel; old names removed in a separate
      commit; .env.example updated.
- [x] README: what it is, architecture, setup, run, test, deploy, build log.
- [x] Tests green after every cleanup step.

## 2. The mechanic (D0, D1)
- [ ] Two sides, one pot, one Gemini contract; YES deposits q·N, NO deposits (1−q)·N at creation.
- [ ] An offer stays open only while the smoothed price is within the tolerance of q.
- [ ] Shares are computed from the smoothed price, never booked; funds move only on exit or settlement.
- [ ] Exit is a binding request; the price is the time-weighted average of valid samples taken after
      the request; too few samples means no exit and the pot continues.
- [ ] The exiting side pays the fixed fee to the other side.
- [ ] No exits in the lock-out before close, on a failing market, or while halted or under review.
- [ ] Without exits Gemini's settlement decides; no settlement by the deadline returns both deposits.

## 3. Extras on the same rules (D2, D4)
- [ ] Net (floor) and bowl (target) file an exit request automatically through the threshold engine.
- [ ] Partial exit; nine lives as partial exits in ninths.
- [ ] Handshake: both agree, divided at the current smoothed price, no fee.
- [ ] Takeover: a third party takes the exiting side's place at the exit price; positions transferable.
- [ ] Honor record per account: pots played, held to the end, exits (own, net, bowl), handshakes,
      takeovers, results. Facts only.

## 4. Contract and technical depth (D0, D1)
- [x] Design document before code: states Open, Live, ExitRequested, Divided, Settled, Expired and
      every transition; no path strands funds (docs/pot-design.md; Joining added for forward-priced joins).
- [x] Integer fixed-point math; rounding defined for every division; written proof that payouts sum
      to the pot exactly (pot-design 3.3; fuzz-tested; halmos timed out, so not machine-proven).
- [x] EIP-712 M-of-N price attestations bound to chain, contract, pot, window start and end, sample
      count and evidence hash; signer, window, ordering and replay checks on-chain.
- [x] Anyone may submit a valid attestation or settlement.
- [x] Positions as transferable tokens (ERC-721, transfer rules in pot-design 2). [ ] Fair-value read
      from a supplied attestation: not in the contract (no space left under the 24 KB limit); to be
      offered as a separate stateless reader contract in D5.
- [x] Cap on N tied to measured depth, enforced at creation via an attestation (0.25 × contracts within 5¢, $25 max).
- [x] Pausing stops new pots only; exits, settlements and expiries always work.
- [x] Claimable balances for blocked recipients.
- [x] Unit, fuzz and invariant tests (conservation, no double division, no division without a valid
      attestation, no exit in lock-out); symbolic checks with halmos ran but timed out (no counterexample, not a proof); what is proven vs tested stated
      plainly (pot-design 12).
- [x] Threat model: stale-price exit, thin-book manipulation, colluding signers, exit-request
      griefing, takeover front-running, creator-chosen tolerance; what stops each and what does not.

## 5. Prices and evidence (D2)
- [ ] p = midpoint within the spread and depth rules, smoothed, sampled independently by each signer.
- [ ] Exit windows use only samples after the request time.
- [ ] Every division stores an evidence record; public pages show hash and computed values; the two
      sides see the raw samples.

## 6. Sponsors, each with a real job (acceptance check in brackets)
Arc
- [ ] USDC is the only asset including gas; both decimal views handled [test on the 6/18-decimal views].
- [ ] Join and exit by EIP-3009 signature, users pay no gas [e2e: a side with zero native balance joins and exits].
- [ ] Create-and-fund and divide-and-pay are single transactions via Multicall3From [tx hashes in the e2e log].
- [ ] Reason for every payout attached via Memo and shown in the UI [memo decoded on the pot page].
- [ ] Time from attestation to final payout measured and shown [value on the pot page and /status].
- [ ] Funding from other chains through Circle CCTP [one real transfer landing on Arc].
Gemini
- [ ] Market discovery and quality ranking from the order book [/markets, /api/catalog].
- [ ] Live price sets each side's share [rope view matches the book midpoint].
- [ ] Forward-window average prices every exit [evidence record of an exit].
- [ ] Market status gates exits [test: exit refused while halted/under review].
- [ ] Settlement ends pots nobody left [e2e: pot held to settlement].
- [ ] Depth is the basis of the cap on N [creation refused above the cap].
- [ ] "Data provided by Gemini" wherever prices appear [page check].
QuickNode
- [ ] Streams is the primary source for every pot event [events table shows source=streams].
- [ ] Filter on QuickNode's side for our contracts; RPC polling as fallback; UI shows the path and
      delay per event [/live].
- [ ] Backfill from Streams after downtime [documented run].
- [ ] /how-it-is-built shows these three lists with live evidence per item.

## 7. The cat (D3)
- [ ] One cute inline-SVG cat component in the existing colours, all poses (rope, wobble, crouch, air,
      landing, net, bowl, handshake paw, second cat, sleeping, peeking, empty box, nine paw marks).
- [ ] Reduced motion respected; text alternative for every pose.
- [ ] Pose sheet at /design/cat approved before use.
- [ ] Rope view: posts, names, shares in dollars, cat at the price, two fill colours, paw path, net,
      bowl, exit animation with countdown ring and exit-price stamp, walk to the winner; TV version.

## 8. Pages (D3 to D5)
- [ ] Landing with one live pot; create; invite and join; pot with the rope view; large-screen view;
      my pots; honor record; terms per pot; proof per pot; markets; status and live flow;
      how-it-is-built; developers.

## 9. Honesty and safety
- [ ] Testnet banner and "not financial advice" on every page.
- [ ] Plain terms per pot covering every edge case.
- [ ] Neutral wording (pot, side, share, exit, land); no bet, wager or win.
- [ ] Low maximum N on testnet and a note on playing within limits.
- [x] Testnet only; secrets only in environment variables.

## 10. Tests that must exist
- [ ] Stale-price attack: an exit requested just before a jump is priced after the jump.
- [ ] A short price spike does not move an exit price materially.
- [ ] Exit refused in lock-out, on a failing market and without enough samples.
- [ ] Partial exits in ninths never lose or create a cent.
- [ ] Handshake, takeover, net and bowl, expiry.
- [ ] End to end against production: held to settlement, ended by exit, one handshake, one takeover.
