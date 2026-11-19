# Honor: the computation rules

Honor rewards conduct, never results. Winning, stake size, leverage and volume earn nothing.
Leaving a pot is a right: it earns nothing and costs nothing. Honor is not a token, is never
airdropped, cannot be bought, sold or transferred, has no cash value, and is never exchanged for
money or fee discounts. Its symbol is a small collar bell (paw prints stay the market cat's trail,
cat heads stay lives).

This page is the specification: anyone can recount honor from Arc's events with it and compare.
The code is `relay/src/honor/compute.ts` (pure: the same input and rules version always give the
same history and balances), the values are `relay/src/honor/config.ts`, the tests
`relay/test/honor.test.ts`.

## Inputs

1. Every event of the pot contracts (HonorCatPots v1, every HonorCatRopes deployment) and of
   HonorCatPerps, ordered by block and log index: `PotCreated`, `Transfer`, `Joined`, `Handshake`,
   `TakenOver`, `ExitRequested`, `PotDivided`, `PotSettled`, `PotExpired`, `ReferrerSet`, and the
   perps' `PerpOpened`, `PerpJoined`, `RopeStarted`, `LeaveRequested`, `PerpEnded`.
2. The signed "Well played" notes (`pot_notes`): the one input that is not on-chain. Each note is
   signed by the player (wallet signature or passkey assertion) and kept with its time.
3. Practice pots (the practice cat is the other side) and Grok Bot seat pots: excluded.
4. The first funder of each player that earned honor (Arc's explorer: the oldest token transfer to
   the account), and the pairs flagged by the daily farming check.
5. The time counted up to: the time of the last event counted.

Points are kept in hundredths; pages show one decimal.

## Earning (rules version 1)

| Action | Honor |
|---|---|
| Holding a pot or a perp to its end | 2 per hour held, at most 20 per pot |
| A handshake | 10 to each side |
| An open side of mine is joined (pot or perp) | 5 |
| Taking over a side so the other player can go on | 10 |
| Sending "Well played" | 1, once per pot |
| A referred friend finishes their first pot that counts for honor | 20 |
| Joining a group on the smaller team (groups are not built yet) | 5 |
| Playing on consecutive days (UTC) | 3 per day after the first, at most 7 days in a row |

Details:

- "To its end": a pot ends when it is settled, its deposits go back, or it is divided in full
  (knock-out, expiry, handshake, or one side leaving). The side that left earns nothing for
  holding; the side that stayed held it to the end. Partial exits do not end a pot. Hours count
  from the later of the join and the moment the player got the side.
- A perp's hold counts from its first rope to the end of the chain; a player who asked to leave
  earns no hold.
- Perp ropes are held by the perps contract, which is not a player: the perp counts once, as a
  chain.

## Anti-farming

- **Minimum stake**: a side under $0.10 earns nothing (for a perp: a budget under $0.10).
- **Minimum duration**: a pot or perp that ends within 10 minutes of starting earns nothing at all.
  The honor of a running pot counts once it is 10 minutes old.
- **Same counterparty**: the first pot with a player within 24 hours counts in full; each further
  pot with them in that window halves again (the join, handshake and hold of one pot are one
  action). Two linked accounts trading handshakes earn at most twice the first handshake per day,
  and much less once untrusted.
- **Trust tiers**: an account earns half honor until it has finished pots with 3 different
  trusted players. Before 20 November 2026 00:00 UTC any counterparty counts (the founding
  players); after it only trusted ones, so a closed circle of new accounts never vouches for
  itself and stays at half.
- **Same funding source**: no honor between two accounts first funded from the same address,
  except HonorCat's own wallets (welcome money, the practice cat), which fund unrelated players.
- **Practice and Grok Bot pots** earn nothing.
- **Daily farming check**: pairs with at least 5 pots with each other in 7 days, at least 70% of
  them joined within a minute and ended within an hour, are flagged. Their honor from each other is
  removed from the first such pot on; the history keeps the entry with points struck through and the
  reason.
- **Referrals** count only when the referred friend's own pot passed the same checks.

What the checks can catch: the same person on two accounts funded from one wallet; quick pots
traded between two accounts; a closed group of new accounts. What they cannot catch: one person
with several accounts funded from different places who plays slowly and with many others looks
like several honest players. That is the main reason honor buys nothing.

## Titles and cosmetics

Titles: Stray from 0, House Cat from 20, Honor Cat from 100, Lion from 400.
Cosmetics (they replace the milestone unlocks once Honor is on): bell collar at 1, green scarf at
20, blue bow tie at 50, captain's hat at 100, golden crown at 250.

## Proposals (not in version 1; for the owner to decide)

- **A rematch accepted: 3 to each side.** Coming back to play the same person after a pot ended is
  good sport; the same-counterparty halving keeps it from being farmed.
- **Taking an offer that waited over an hour: 3.** It gives someone their game; it rewards no
  result and no size.
- **No honor lost, ever, for leaving** stays as is: leaving is a right.

## Proof on Arc (next)

A small contract, HonorRoots, will store one Merkle root a day with the rules version and the last
block counted; each leaf is (account, total honor, rules version, day). A public endpoint returns a
player's proof, a verify page checks it in the browser against the root on Arc, and a view function
lets any contract check an account's honor.
