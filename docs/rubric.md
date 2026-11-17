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
- [x] Two sides, one pot, one Gemini contract; YES deposits q·N, NO deposits (1−q)·N at creation
      (forward-priced: q is the 30-second average after the join; escrow above the share refunded; pots 3-7).
- [x] An offer stays open only while the smoothed price is within the tolerance of q (the join fails outside the band).
- [x] Shares are computed from the smoothed price, never booked; funds move only on exit or settlement.
- [x] Exit is a binding request; the price is the time-weighted average of valid samples taken after
      the request; too few samples means no exit and the pot continues (pot 2: ExitFailed, continued).
- [x] The exiting side pays the fixed fee to the other side (1%; pot 3 balances).
- [x] No exits in the lock-out before close, on a failing market, or while halted or under review
      (contract: test_exit_refusedInLockout; relay: marketGate and the too-few-samples tests in relay/test/pots.test.ts).
- [x] Without exits Gemini's settlement decides (pot 7); no settlement by the deadline returns both deposits (contract expiry tests).

## 3. Extras on the same rules (D2, D4)
- [x] Net (floor) and bowl (target) file an exit request automatically through the threshold engine (pot 6).
- [x] Partial exit; nine lives as partial exits in ninths (contract tests; pot page).
- [x] Handshake: both agree, divided at the current smoothed price, no fee (pot 5).
- [x] Takeover: a third party takes the exiting side's place at the exit price; positions transferable (pot 4).
- [x] Honor record per account: pots played, held to the end, exits (own, net, bowl), handshakes,
      takeovers, results. Facts only (/record/<address>, from pot_events).

## 4. Contract and technical depth (D0, D1)
- [x] Design document before code: states Open, Live, ExitRequested, Divided, Settled, Expired and
      every transition; no path strands funds (docs/pot-design.md; Joining added for forward-priced joins).
- [x] Integer fixed-point math; rounding defined for every division; written proof that payouts sum
      to the pot exactly (pot-design 3.3; fuzz-tested; halmos timed out, so not machine-proven).
- [x] EIP-712 M-of-N price attestations bound to chain, contract, pot, window start and end, sample
      count and evidence hash; signer, window, ordering and replay checks on-chain.
- [x] Anyone may submit a valid attestation or settlement.
- [x] Positions as transferable tokens (ERC-721, transfer rules in pot-design 2). [x] Fair-value read
      from a supplied attestation: HonorCatFairValue (0x8a89...71a5), a separate stateless reader, because
      HonorCatPots has no space left under the 24 KB limit; verified on-chain with a signed quote of pot 2.
- [x] Cap on N tied to measured depth, enforced at creation via an attestation (0.25 × contracts within 5¢, $25 max).
- [x] Pausing stops new pots only; exits, settlements and expiries always work.
- [x] Claimable balances for blocked recipients.
- [x] Unit, fuzz and invariant tests (conservation, no double division, no division without a valid
      attestation, no exit in lock-out); symbolic checks with halmos ran but timed out (no counterexample, not a proof); what is proven vs tested stated
      plainly (pot-design 12).
- [x] Threat model: stale-price exit, thin-book manipulation, colluding signers, exit-request
      griefing, takeover front-running, creator-chosen tolerance; what stops each and what does not.

## 5. Prices and evidence (D2)
- [x] p = midpoint within the spread and depth rules, smoothed, sampled independently by each signer.
- [x] Exit windows use only samples after the request time (window starts at request + 1 s; contract-checked).
- [x] Every division stores an evidence record; public pages show hash and computed values (proof page).
      [x] The two sides see the raw samples (proof page, after one passkey or wallet signature; Gemini's data terms).

## 6. Sponsors, each with a real job (acceptance check in brackets)
Arc
- [x] USDC is the only asset including gas; both decimal views handled [relay balance check on both views, /status].
- [x] Join and exit by EIP-3009 signature, users pay no gas [e2e pots 3-7: sides sign, the relay submits].
- [x] Create-and-fund and divide-and-pay are single transactions via Multicall3From [tx hashes in the e2e log].
- [x] Reason for every payout attached via Memo and shown in the UI [memo read back from the payout transaction on Arc, shown per window on the pot page].
- [x] Time from attestation to final payout measured and shown [median on /how-it-is-built; not yet per pot].
- [ ] Funding from other chains through Circle CCTP [one real transfer landing on Arc].
Gemini
- [x] Market discovery and quality ranking from the order book [/markets, /api/catalog].
- [x] Live price sets each side's share [rope view matches the book midpoint].
- [x] Forward-window average prices every exit [evidence record of an exit, /pots/3/proof].
- [x] Market status gates exits [test: relay/test/pots.test.ts "market status gate"].
- [x] Settlement ends pots nobody left [e2e: pot 7, tx 0xc5ecfc86...9dc1].
- [x] Depth is the basis of the cap on N [creation refused above the cap: contract test AboveCap].
- [x] "Data provided by Gemini" wherever prices appear [page check].
QuickNode
- [x] Streams is the primary source for every pot event [events table shows source=streams since the filter update: PotSettled of pot 7; earlier events backfilled by polling].
- [x] Filter on QuickNode's side for our contracts (now including HonorCatPots); RPC polling as fallback; UI shows the path and
      delay per event [/live, /how-it-is-built].
- [x] Backfill from Streams after downtime [documented run: docs/streams-backfill.md].
- [x] /how-it-is-built shows these three lists with live evidence per item.

## 7. The cat (D3)
- [x] One cute inline-SVG cat component in the existing colours, all poses (rope, wobble, crouch, air,
      landing, net, bowl, handshake paw, second cat, sleeping, peeking, empty box, nine paw marks).
- [x] Reduced motion respected; text alternative for every pose.
- [x] Pose sheet at /design/cat approved before use (approved by the user, 2026-11-16).
- [x] Rope view: posts, names, shares in dollars, cat at the price, two fill colours, paw path, net,
      bowl, exit animation with countdown ring and exit-price stamp, walk to the winner; TV version.

## 8. Pages (D3 to D5)
- [x] Landing with one live pot; create; invite and join; pot with the rope view; large-screen view;
      my pots; honor record; terms per pot; proof per pot; markets; status and live flow;
      how-it-is-built; developers.

## 9. Honesty and safety
- [x] Testnet banner and "not financial advice" on every page (header).
- [x] Plain terms per pot covering every edge case (/pots/<id>/terms).
- [x] Neutral wording (pot, side, share, exit, land); no bet, wager or win (pages checked by search).
- [x] Low maximum N on testnet and a note on playing within limits ($25; start page, terms, landing).
- [x] Testnet only; secrets only in environment variables.

## 10. Tests that must exist
- [x] Stale-price attack: an exit requested just before a jump is priced after the jump (relay/test/pots.test.ts).
- [x] A short price spike does not move an exit price materially (a 30-point, 2-second spike moves it about 2 points; the median drops a spike one sampler caught).
- [x] Exit refused in lock-out, on a failing market and without enough samples.
- [x] Partial exits in ninths never lose or create a cent (HonorCatPotsPartial fuzz).
- [x] Handshake, takeover, net and bowl, expiry (contract suites).
- [x] End to end against production: held to settlement (7), ended by exit (3), one handshake (5), one takeover (4).

## 11. Browser review of production (2026-11-16)
- [x] Solo try-out: a clearly labelled practice opponent (the relay) takes the other side of a
      visitor's pot on testnet, and a button sends a new visitor a little test USDC; a first-time
      visitor creates a pot, watches the rope and exits within two minutes, alone
      [relay/scripts/practice-e2e.ts: new wallet, 2 USDC gift, pot 13 created, joined by the practice cat, left and paid out in 93 s].
- [x] Rope view reads as a rope between two posts, with the 0 to 100 scale and the approved
      mockup's ruler ticks, the paw trail, and the net and bowl when set.
- [x] A pot that continued after an exit window (pot 4: taken over) explains what happened;
      partial exits are labelled and the remaining pot is shown ("What happened" on each pot page).
- [x] Each side can set a display name; addresses only in the technical details (unnamed players get a stable cat nickname).
- [x] Market names give the league, both teams, the date, and what YES means in plain words (from Gemini's own contract rule).
- [x] Landing: a three-line worked example with two names and dollar amounts under the headline.
- [x] Animated amounts have a plain text label for screen readers.
- [x] /how-it-is-built: the count of price windows matches its breakdown (23 = 19 + 2 + 2).
- [x] The share of pot events first seen by Streams since the filter was set is reported, and
      Streams is the primary path (49 of 60, 82%, since block 72,538,134; the RPC poller now trails the head by 90 blocks).

## 12. Polish (docs/polish-spec.md)
### P1. Try it alone
- [x] Practice pots stay out of the honor record, public pot lists and the public event counts;
      their owner still sees them, marked "Practice" (relay/test/practice-record.test.ts).
- [x] New visitors get test USDC without a faucet, limited per account and per day ($2 welcome,
      top-ups up to $10 per account and $80 in total a day).
- [x] The practice cat is checked before a practice pot is created; if it cannot play, the page
      says why and what to do instead, and a pot it fails to join opens for a real opponent.
- [x] A new visitor creates a pot, watches the rope and exits within two minutes, alone, at phone
      width [relay/scripts/phone-solo.mjs, iPhone 13 viewport, new passkey: pot 18 created,
      joined by the practice cat, left and paid out in 102 s, no sideways scrolling].
### P2. Your own cat instead of an address
- [x] On first sign-in a person picks a fur colour (six) and a name for their cat, saved with one
      signature or passkey confirmation; it is their identity on the rope, in invitations, in
      lists and on the honor record (checked in the browser: new passkey, ginger "Mochi" saved in 2.6 s).
- [x] Player addresses appear only under "Show technical details" (sampler signers stay on the proof pages).
- [x] Names are display only (never used to authorise), 2 to 20 characters, plain characters,
      reserved names refused and offensive names filtered, also when spaced out
      (`obscenity` library; relay/test/names.test.ts).
- [x] Three cats in the pot view: each player's cat on its post, tail high when its side is up 3
      points since the entry price and ears low when it is down, and the market cat on the rope;
      players without a chosen cat get a stable fur that is never HonorCat's black.
### P3. Plain questions and three numbers
- [x] Every market reads as a plain statement and its opposite ("Baltimore beats Los Angeles
      Chargers" / "Baltimore does not beat Los Angeles Chargers"; spreads, draws, crypto and the
      rest handled), with league, both teams and the local start time with its time zone; YES and
      NO only in the technical details (web/src/lib/statement.ts, relay/test/statement.test.ts).
- [x] The pot page shows three large amounts to a player: if I leave now (an estimate after the
      fee), if I stay and it happens, if I stay and it does not.
- [x] Creating a pot asks only for your own amount and shows "Your opponent puts in X. The pot is
      Y." with the line that the favourite costs more so nobody starts ahead (the band, the
      accepted price and the settlement days are under "More options").
- [x] An "Even markets (40 to 60%)" filter on the market list (catalog `even=1`).
- [x] Phone-width solo run still under two minutes after the change (97.7 s, pot 20).
### P4. The rope
- [x] A rope between two posts, not a bar: the 0 to 100 ruler with ticks, the paw trail, the net
      at a side's floor and the bowl at its target (checked live on pot 22: "your net at 30%",
      "your bowl at 97%"), each player's cat on its post.
- [x] The rope is filled in each player's fur colour on their side of the cat, over an ink cord so
      light furs show; the same fur on both sides falls back to the signal colour for the second.
- [x] Matches the approved mockup's ruler, cat label and zones; the big-screen view uses the same
      rope, statement heading and cats (checked on /pots/17/tv).
### P5. An exit that explains itself
- [x] Before confirming: an estimate after the fee and the sentences that the final price is the
      average of the next 30 seconds and that the request cannot be withdrawn ("Yes, leave" / "Not now").
- [x] During the window: crouch, countdown ring, jump, then the landing and the price stamp.
- [x] Afterwards: what each side received, the treat (fee), and links to the evidence and the
      payout; a partial exit is labelled and the page shows what remains in the live pot.
- [x] The exit is described as instant nowhere (searched the web app).
### P6. Honor, made visible
- [x] Handshake is its own button next to "Leave", with the two cats holding out a paw and the line
      that it splits now at the current price with no fee, if both agree.
- [x] The code of honor (three sentences) at the top of every pot's terms; the full terms follow.
- [x] After a pot ends each player can send "Well played" (signed) and offer a rematch on a new
      market, a friend draft only the other player can join (relay/test/pot-notes.test.ts; checked
      live on pot 22).
- [x] The honor record keeps the facts and adds plain labels read from them ("Holds to the end",
      "Often splits by handshake", …), each with the facts it comes from; no score
      (relay/test/honor-labels.test.ts).
- [x] Joining is "Give your word"; the exit fee is "a treat for the other cat", always with its
      dollar amount.
### P7. A cat in every state
- [x] One `CatState` on top of the one Cat: loading peeks in, empty sleeps, an error looks into an
      empty box (in plain words), success lands, waiting sits at its post.
- [x] Blink, swaying tail and a wobble when the price moves fast; all stop under reduced motion,
      and every pose has a text alternative (also naming the cat's fur and mood).
- [x] The closing block shaped like a cat's face (ears and eyes) ends the landing page.
- [x] No emoji or stock art; one cat component.
### P8. Landing page and sharing
- [x] Under the headline, a three-line worked example with two cats (Mochi, ginger; Tofu, white)
      and dollar amounts: the start, a moment when one leaves, and what each gets.
- [x] Invitations by link and QR code (the pot page and the friend draft); every pot link carries a
      preview image with the question, the rope with the cat at the last price and both amounts
      (/pots/<id>/opengraph-image, checked for pot 22).
### P9. Clear messages and access
- [x] Every error and refusal goes through one table of plain sentences that say what happens next
      (web/src/lib/messages.ts, relay/test/messages.test.ts); bare "HTTP 500" never reaches a page.
- [x] Animated amounts have a plain text label for screen readers.
- [x] Sixteen pages checked at phone width and with keyboard only: no sideways scrolling, no axe
      WCAG 2 A/AA violations, every keyboard stop visible and named (relay/scripts/a11y-check.mjs;
      fixed: the technical-details switch's name, underlined links in text, a focusable table scroller).
### P10. Loose ends from the review
- [x] The sponsor page's count of price windows equals its breakdown (after the rebuild: 2 = 2 + 0 + 0).
- [x] The memo on Arc is decoded on the pot page (the sponsor page marks it done).
- [x] Streams is the primary path again: the stream was terminated by QuickNode during the database
      outage and resumed with a clean webhook address; since block 72,600,235, 34 of 34 pot events
      (100%) were first seen by Streams; the RPC poller (90 blocks behind) is the fallback. The share is
      on /status and /how-it-is-built.

## 13. Build list of 2026-11-16 (parts 1 to 8)
- [x] 1 to 3 (solo try-out, rope view, names and wording): see sections 11 and 12.
- [x] 4. A price chart on every pot (Gemini's candles) with the entry, every exit, handshakes and the
      settlement marked, a hover readout and a table view; one sentence per market in the picker on
      why it works or does not.
- [x] 5. Cat sitter / Grok Bot, as a tool connection (MCP, `/api/mcp`, chosen over a web seat after
      reading xAI's Grok Bot docs): seats created and revoked by the signed-in player, 24 h expiry,
      testnet limits, never withdraw; per-pot powers (exits alone when signed in advance, nets,
      bowls and handshakes with approval); every action logged with the agent's one-line reason and
      shown on the pot page ("minded by a cat sitter" / "played by an agent"); agent pots out of
      honor records; /grok-bot with a job description; counts on /how-it-is-built.
      Tests: relay/test/agent-seats.test.ts; production: scripts/agent-seat-e2e.ts (10 checks incl.
      revoke → 401 at once), scripts/agent-play-e2e.ts (pot 24: agent took the side, set a net and
      left; `--sitter`, pot 25: net became a proposal, the full exit signed in advance went alone).
- [x] 6. QuickNode Streams first for every pot event, RPC polling as the fallback; /status shows the
      share first seen by Streams (34 of 34 since the stream resumed).
- [x] 7. README: what HonorCat is, an architecture diagram (Mermaid), setup, run, test and deploy; the
      economic design and its risks; every contract address; how HonorCat uses Arc; the Stream setup;
      Grok Bot; a dated build log.
- [x] 8. The helper cat in the app (templates until xAI credits exist; never presented as Grok): one
      sentence each on leaving, staying and shaking hands beside the exit confirmation, and on nets and
      bowls once the player starts setting them, all with our own numbers; a wish box ("protect half my
      stake", "take my share off at $8.50") that fills in a net or bowl the player then saves. It never
      moves funds or says which side to take (relay/test/helper.test.ts; browser run on pot 26).
- [x] Grok Bot connection made simple: one confirmation on /grok-bot, one copied message (the
      connector link `/api/mcp/<seat>` plus the job description) to paste into Grok Bot; the plain link
      as plan B; checked in the browser and by agent-seat-e2e.ts (12 checks: the link works without a
      header and gets 401 the moment the seat is revoked).

## 14. Browser review of production (2026-11-17)
- [x] Shares always add up to the pot: one side rounded to the cent, the other the pot minus it, on
      the rope, landing, big screen, three amounts and link previews (web/src/lib/shares.ts,
      relay/test/shares.test.ts; pot 4 now $0.75 + $0.25 on both pages).
- [x] /pots/new?practice=1 says at the top that the visitor plays the practice cat with test money,
      and lists what happens next.
- [x] /status: no retired vault or old pot counts; the relay wallet, a runway in relay transactions
      at their measured cost, today's pots; Streams named as the primary source. /how-it-is-built:
      one consistent Streams figure (51 of 51 since block 72,600,235) with the rebuild explained.
- [x] The price chart starts at the entry; where Gemini's history is missing, the line is dashed and
      a sentence says so; labels sit in rows so entry and takeover no longer overlap.
- [x] Gateway run end to end again (Circle attested, the Circle wallet minted $0.08 on Arc in 2.7 s,
      tx 0xad981c8b…ccaf); the item says exactly what was run (from Arc) and what was not (other chains).
- [x] Full team names everywhere, also inside spreads, totals and events that list only short names
      (relay/test/statement.test.ts; no "Los Angeles C" left on /markets, /pots/new, /pots or /).

## 15. Everyday app (2026-11-17), built in the order agreed
- [x] Every market links to its page on Gemini (`https://www.gemini.com/predictions/<slug>`, the slug
      from Gemini's events API, checked to open that event): in the market lists, on the start page and
      on every pot page (finished games looked up by ticker); also in Grok Bot's market tool.
- [x] Part 6, Arc in plain words: each action shows its Arc network fee in cents next to it
      (`/api/hc/fees`, the 7-day average per action from the relay's own receipts) and who pays it;
      every payout becomes a receipt sentence ("You left at 74.5% and received $7.40.") with how
      long it took after the request, its own fee, and a link to the transaction that carries the
      memo (`web/src/lib/receipts.ts`, tested in `relay/test/receipts.test.ts`).
