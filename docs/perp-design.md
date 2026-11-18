# Normal pots and perps: design note (P0, 2026-11-18)

The app offers two things: a **normal pot** (posts at 0 and 100, runs to settlement unless someone
exits: today's behaviour) and a **perp** (each side picks its own leverage, the rope renews itself).
This note says what HonorCat v2 already covers, what needs a new contract, and the decisions needed.
Nothing is built until they are answered.

## Already true in v2 (HonorCatRopes, deployed)

- Posts from leverage: YES `L = q·(1 − 1/lev)`, NO `U = q + (100 − q)/lev`; leverage 1 puts the post at
  0 or 100 (the create page's `ropeFor` uses exactly these). Each side's post is independent.
- Deposits follow from the posts; each side can win at most the other side's deposit (the clamp).
- Both sides at 1×: exactly a normal pot (no expiry, runs to settlement).
- Minimum distance (5 points or twice the spread), maximum leverage (10× crypto, 5× elsewhere), the
  cap, knock-out, expiry, extra lives, treats.

## What needs a new contract (v3; v2 cannot be changed)

1. **The joiner fixes its own post when joining.** In v2 the creator fixes both distances at creation.
   v3: `create` takes only the creator's leverage; `requestJoin` takes the joiner's leverage. The
   market's limits (spread → minimum distance, category → maximum leverage) are stored at creation
   from the depth attestation, so the joiner is checked against the same attested limits. The
   joiner's escrow is its worst case over the band for its own post, plus the maker treat.
2. **The perp roll.** A chain of ropes with auto-roll on, each side keeping its leverage, paid from a
   budget split into lives. This needs the rolling-ropes spec (below), because it decides where money
   sits between ropes.

## Proposal for the roll (to confirm against the rolling-ropes spec)

- Each side deposits a **budget** = lives × its first rope's deposit (lives chosen from fixed steps,
  e.g. 3, 5, 9). The budget stays in the contract.
- A rope ends as today (knock-out at a post, or expiry), divided at the forward-priced, clamped price.
  Each side's share goes back into its budget. If both budgets can pay the next rope's deposits and
  the market allows another rope (expiry rule: at least 10 minutes of life, 2 hours before close),
  the next rope starts at once, with **the division price as its entry** (already forward-priced, so
  no new join window), each side's leverage unchanged, so new posts around the new entry.
- A side's "lives left" = its budget / its next deposit, rounded down; shown with one life symbol
  everywhere (not the paw prints of the trail).
- A perp ends when a player stops it (that side's budget is paid out after the current rope ends, or
  at once by an exit priced like today's), when a budget cannot pay the next rope, or when the market
  can no longer carry a rope. Then both budgets are paid out.
- Rope length: one fixed roll interval per perp, chosen at creation (proposal: 1 hour, 6 hours or 1 day,
  within the expiry rule).
- Fees: no fee on a roll; the exit fee only when a player stops early (as today).

## Decisions needed

1. The rolling-ropes spec: please paste it. The proposal above is my reading of "a chain of ropes with
   auto-roll, budget split into lives"; the spec wins where they differ.
2. Where a rope's winnings go: back into the budget (proposed: the perp keeps running on its
   result), or to the player's wallet after each rope.
3. Roll interval per perp: fixed steps (1 h, 6 h, 1 day), or always "as long as allowed"?
4. Deploy v3 as a new contract on Arc testnet, with new pots (normal and perp) going there once you
   switch, as with v2. v1 and v2 pots keep working where they are.

## Interface (after the decisions)

Create page: two cards, "Normal" and "Perp", each with one sentence; Perp adds a leverage picker
(fixed steps) and a budget in lives, with the effect in plain words. Join page: the creator's leverage
shown, the joiner picks its own. Pot page: label "Normal" or "Perp 6× vs 2×", the chain of ropes,
lives left and the result so far. Open sides, leaderboard and copycat show the kind and leverage.

## Tests (planned)

Posts from leverage match the formulas for both sides; leverage 1 on both sides behaves exactly like
today's normal pot; a joiner cannot set a post that breaks the distance or leverage rules; plus the
roll: budgets conserved across rolls, a roll never starts without both deposits, every chain can end.
