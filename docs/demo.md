# HonorCat demo route (about 6 and a half minutes)

Everything is live on https://honorcat.vercel.app, Arc testnet, test money only. Open the pages in
this order; each step says what to point at and which sponsor it is for.

## 1. Start page (30 s): what HonorCat is
https://honorcat.vercel.app/
- "Take a side on a real Gemini question; leave at the live price whenever you like, or hold to the
  result." Micky and Morty's worked example: $6 and $4 on a $10 pot, the price moves, Micky leaves
  with $7.40.
- Three ways to play: a pot, a perp, a group. Nothing goes to a house.

## 2. A perp running on a live market (1 min 30 s): Gemini + Arc
https://honorcat.vercel.app/perps/17 (Iowa State vs UCF) or /perps/18 (Syracuse vs Boston College)
- The rope between two posts 15 points either side of the price; the cat stands at the 30-second
  middle of Gemini's order book. Each player's lives (cat heads) and the rule under them.
- Every hour the rope is divided at the measured price and the next one starts there, by itself.
- "Ropes": each rope's leverage and how it ended; open a rope's "Details" for the three samplers'
  averages ("the contract took the middle one"). Older ropes are under "All N ropes".
- Earlier evidence of knock-outs on a live market: /perps/13, ropes 11 and 12 (knocked out at a
  post, next rope started at the division price).

## 3. A group (1 min): two teams on one market
https://honorcat.vercel.app/groups/3 and the big screen https://honorcat.vercel.app/groups/3/tv
- Micky's team vs Morty's team on Iowa State vs UCF; joins and leaves are gathered for a minute and
  priced together over the 30 seconds after. "What happened" shows the latest steps with their receipts
  on Arc ("N earlier" opens the rest).
- The big screen: rope, team cats with member counts, reactions, a join QR code per team.

## 4. A closed pot and its proof (1 min): trust in the numbers
https://honorcat.vercel.app/pots/19 then "proof"
- The final state from the pot's own events: settled by Gemini, $0.00 and $1.00, the cat landed.
- The proof page: every price window, each sampler's signed average, the rule (median of three, mean
  of two within half a point), checked on-chain by the MedianResolver.

## 5. Posts (30 s): players talk about their plays
https://honorcat.vercel.app/perps/17 (scroll to "Posts") then https://honorcat.vercel.app/posts
- A player writes a short post about a play they are in; HonorCat checks they hold a side, and the
  post shows it ("YES on UCF · perp 17 · running when posted"). Signed by the player, moves no money.
- /posts: Everyone and Following. Private pots never show up.

## 6. For the sponsors (1 min 30 s)
https://honorcat.vercel.app/status and https://honorcat.vercel.app/how-it-is-built
- **QuickNode:** Streams is the primary source: "Last delivery … s ago", deliveries in the last 5
  minutes, and the share of pot events first seen by Streams since the stream started (the RPC
  poller trails 10 blocks behind as the fallback).
- **Gemini:** every price is the middle of Gemini's public order book, measured by three
  independent samplers; markets are ranked by spread and depth (/markets); a "Trade this market on
  Gemini" link on every pot, perp and group.
- **Circle / Arc:** USDC is the only asset (gas included); passkey accounts where HonorCat pays the
  fee; a Gateway transfer end to end (1 USDC deposited on Arc, $0.40 minted by the Circle wallet in
  2.8 s, tx 0x5fceacd0…e58); send money to a player by name ($0.03 in 2.2 s); every contract address
  listed and linked.
- Honor: one Merkle root of all honor balances per day on HonorRoots (/honor/verify checks a balance
  in the browser against the root on Arc).

## If something is slow
- A price window takes about 30 s plus a few seconds for the samplers to agree; the page says what is
  being priced. Nothing moves without an agreed price.
- With the laptop's sampler off, two samplers still price ("the mean of two").
