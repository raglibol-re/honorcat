# Group pots (teams): the design

Two teams take opposite sides of one Gemini market ("Texas fans" and "Arkansas fans"). Anyone can
join a team with any amount. Normal pots only: posts at 0 and 100, no leverage. Contract:
`contracts/src/HonorCatGroups.sol`; it reuses the window, depth and outcome attestations and the
MedianResolver unchanged (a resolver instance bound to this contract), and leaves v1 and v2 alone.

## Units

- Notional `n`: what a position is paid if its team's side happens, in USDC base units.
- Price `p` (YES, ppm). A YES unit costs `p`, a NO unit `1 - p`; one unit of each together holds
  exactly one dollar of a unit. The pot always holds the same notional `N` on both teams.

## Batches (joining and leaving)

Time is cut into batches of 60 s from the group's creation. Requests made during batch `k` are
cleared at the price of the 30-second window that starts when batch `k` ends (a forward window:
nobody knows its price when asking). A batch is cleared by an attestation for exactly that window
(`kind` 20, `nonce` = `k`), in order; a batch with nothing in it is skipped, and a batch whose window
got no agreed price (or no attestation within 10 minutes) fails: its joins wait or are refunded,
its exits are returned.

A **join** is a request with an amount (escrowed at once), a team, and a choice: an unfilled rest
waits for the next batches (at most 20, about 20 minutes) or comes back. A **leave** is a request to
exit part or all of a position; it is priced from the window after it, like every exit in HonorCat.

Clearing batch `k` at price `p` (team price `q` = `p` for YES, `1 - p` for NO), per team:

1. **Takeover first.** Waiting joins of the leaver's own team take over the leaving notional at `q`:
   `t = min(exits, joins / q)`. The takers' escrow pays the leavers; the pot does not change.
2. **Leaves on both teams cancel** each other: `c = min(rest YES, rest NO)` leaves the pot on both
   sides, releasing `c` dollars.
3. **The other team shrinks** by what is left, `r`, pro rata: every member of the other team gets
   their part of `(1 - q) × r` back.
4. **New notional** is matched: `M = min(YES joins / p, NO joins / (1 - p), cap - N)`; the larger
   side is filled pro rata. Both teams grow by `M`.

Every leaver is paid `x × q` less the 1% exit fee on the part exited; the fee goes to the other team
pro rata (to the players, never to HonorCat). All joins of a team in a batch are filled by the same
fraction; all leavers of a team in a batch are paid the same price.

## Accounting without loops (product-sum)

No function loops over members. Each team keeps Liquity's stability-pool accumulators: a running
product `P` (each shrink multiplies it by `1 - r / pool`) and a running sum `S` (each payout to the
team adds `payout / pool × P`), with a scale factor (when `P` falls under 1e-9 it is multiplied by
1e9 and the scale goes up) and an epoch (a team emptied in full starts a new epoch). A position keeps
the snapshot it entered at: its notional now is `n × P / P₀`, its payouts so far
`n × (S − S₀) / P₀` (across one scale change at most, as in Liquity). Each batch stores the team's
snapshot when its new notional entered, so a join filled over several batches claims each piece
from its own snapshot. Waiting joins form a pool with their own product (the unfilled fraction), so
carrying them from batch to batch needs no loop either. A member's claim loops over the batches of
their one request, at most 21, never over members.

## Settlement

When the market settles (outcome attested by the samplers), each member of the winning team is
paid their notional; losing positions get nothing; requests still waiting are refunded; leaves not
yet cleared go back to their positions first. If the market voids, or there is no result by the
deadline (the close plus the grace period), each team's remaining deposit (what its members put in,
less what they were paid out) is shared by its members pro rata to their notional.

## Rounding and dust

Every division rounds down against the payee, so the contract can never owe more than it holds.
Rounding dust (at most a few base units per action) stays in the contract for good: it belongs to
no one and nobody, HonorCat included, can take it. Each group keeps its own balance, which never
goes below zero (tested), so one group's dust or rounding can never touch another's money.

## Positions

One position per account per group (one team). Positions can be transferred to an account that has
none in that group, with no request pending.
