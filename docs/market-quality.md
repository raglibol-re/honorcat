# Market quality (F0 and F1, 2026-11-15)

What the Gemini prediction markets behind HonorCat Forward look like right now, and whether the
trigger's default rules can be met on them. Read-only measurement; no code was changed.

## Method
- Snapshot at **2026-11-15 18:14 UTC** from Gemini's public API: every active event in Weather (98)
  and Economics (11), and the 40 nearest Crypto events (of 98). The category "Economy" is listed by
  Gemini but had **no active events**.
- Per active contract: full order book (`GET /v1/book/{symbol}`): best bid and ask, spread, size at
  the best price on each side, depth within 5 cents of the mid. Event-level `volume24h` from the
  events API. Hourly trade candles (`/v2/candles/{symbol}/1hr`) were also read, but they returned no
  volume for every crypto contract, including ones whose event reports volume, so candle volume is
  not used below; event `volume24h` is.
- Our own record: every sample our samplers stored for real pots (`early_samples`, production
  database), grouped by template and the status code the engine gave it.
- Rules checked (`relay/src/trigger/params.ts`, PROVISIONAL_DEFAULTS):

  | Template | Window | Every | Min valid | Max spread | Min size each side | Max data age |
  |---|---|---|---|---|---|---|
  | standard | 30 min | 10 s | 150 | $0.05 | 50 contracts | 60 s |
  | demo | 60 s | 2 s | 25 | $0.04 | 10 contracts | 10 s |

  A sample counts only if the book has both a bid and an ask within those limits. The chance must
  average at least the threshold (default 85%) over the window.

## Results by category

| | Weather | Economics | Crypto (sample) |
|---|---|---|---|
| Active events | 98 | 11 | 98 (40 measured) |
| Active contracts | 644 | 120 | 47 |
| Two-sided books | 135 (21%) | 43 (36%) | 41 (87%) |
| One-sided / empty | 509 / 0 | 50 / 27 | 4 / 2 |
| Median spread (two-sided) | $0.05 | $0.04 | $0.02 |
| Median size at best, smaller side | 100 | 250 | 250 |
| Median notional within 5¢ of mid, smaller side | $4 | $7.50 | $172.50 |
| Pass standard book rule now | 78 (12%) | 40 (33%) | 27 (57%) |
| Pass demo book rule now | 51 | 38 | 27 |
| Events with any 24h volume | 10 of 98 (max $600) | 1 of 11 ($441, Fed) | 3 of 40 (max $421) |

### Weather (daily high temperature, series WXHIGH)
- **49 cities, two days.** Albuquerque, Anchorage, Atlanta, Austin, Baltimore, Birmingham, Boston,
  Buffalo, Chicago, Cincinnati, Cleveland, Columbus, Dallas, Denver, Detroit, Houston, Indianapolis,
  Jacksonville, Kansas City, Las Vegas, Los Angeles, Louisville, Memphis, Miami, Milwaukee,
  Minneapolis, NYC, Nashville, New Orleans, Oklahoma City, Omaha, Orlando, Philadelphia, Phoenix,
  Pittsburgh, Portland, Raleigh, Richmond, Sacramento, Salt Lake City, San Antonio, San Diego, San
  Francisco, Seattle, St. Louis, Tampa, Tucson, Tulsa, Washington DC. One event per city for the high
  on **November 15** (expires 2026-11-16 04:59 UTC) and one for **November 16** (expires 2026-11-17
  04:59 UTC). Nothing further out.
- **Thresholds.** Each event has 7 mutually exclusive contracts: "N°F or below", five 2°F ranges,
  and "M°F or above" (e.g. Albuquerque Nov 15: 54°F or below, 55-56 … 63-64, 65°F or above).
  **"At or below" contracts exist**, but only as the lowest bucket of each event (98 of them, one per
  event); likewise one "or above" per event. Resolution source: the NWS Daily Climatological Report.
- **Books.** 79% of contracts are one-sided: a single resting quote at $0.01 or $0.99 (sizes 100 or
  250, the same on almost every market, which looks like one market maker). A one-sided book gives
  no midpoint, so those samples are rejected ("missing side") and **such a contract can never
  trigger**. Today's events (Nov 15) are mostly decided this way. Tomorrow's (Nov 16) are better:
  102 of their 322 contracts are two-sided, typically $0.04-0.05 wide with 100 a side, e.g. Austin
  "58°F or above" 0.47/0.52, Dallas "62°F or above" 0.48/0.53, Chicago "53-54°F" 0.63/0.66.
- 24 of 98 events have at least one contract that passes the standard book rule right now; 23 of
  the 28 two-sided "or above / or below" contracts pass it. Volume is near zero: 88 of 98 events
  traded nothing in 24 hours.

### Economics
11 events, all longer-dated:
- **Fed decision in December?** (expires 2026-12-11; the only one with volume, $441 in 24 h):
  Hike 25bps 0.85/0.91 (spread $0.06, fails both rules), Hike >25bps 0.07/0.12, Fed maintains rate
  0.05/0.06 (spread $0.01, deep), Cut 25bps and Cut >25bps ask only.
- **U.S. Unemployment in November 2026?** (14 "Above x%" contracts, expires 2026-12-04) and
  **US GDP Growth Index for Q4 2026** (13 "Above x%", expires 2027-01-28): **empty books**, unusable.
- S&P 500 and NASDAQ-100 end-of-2026 ranges (27 and 30 contracts), S&P 2026 high and low, US GDP
  growth 2026 ranges, "How high will unemployment get in 2026", "Recession this year?", Strait of
  Hormuz: quoted, mostly $0.04 wide with 250 a side, no volume.
- No "at or below" strikes are typed as such, but some labels express it ("6,300 or below",
  "3,999.99 or below").

### Crypto (demo template)
Hourly and 5-minute BTC/ETH/SOL/XRP strike markets expiring today. Tighter ($0.02 median) and deeper
(median $172 within 5 cents), which is why the demo uses them.

## What our samplers actually saw (production, all pots so far)

| Template · market | Samples | Valid | Main rejection |
|---|---|---|---|
| standard · WXHIGH (weather) | 1,874 | **62 (3%)** | missing side 1,812 |
| standard · BTC daily | 11,885 | 1,609 (14%) | best bid below 50 contracts: 9,269 |
| standard · NCAAF | 1,271 | 613 (48%) | missing side 616 |
| demo · BTC daily 22:00 | 811 | 802 (99%) | n/a |
| demo · HYPE / ZEC daily | 3,753 | 610 (16%) | missing side, spread |
| demo · BTC hourly (02:00, 03:00, 17:00) | 2,606 | 16 (1%) | missing side, spread |
| demo · BTC 5- and 15-minute | 1,369 | 1 (0%) | missing side, spread |

## Can the default trigger rules be met in practice?
- **Demo: yes, on the right market.** On the liquid BTC contract expiring 22:00 UTC, 99% of samples
  were valid. Hourly and 5/15-minute markets almost never qualify (0-1%); the demo finder now
  watches books before choosing and avoids them.
- **Standard on weather: rarely, as things stand.** The book rule itself is reachable: 100 a side
  beats the 50 minimum, and $0.04-0.05 spreads meet the $0.05 limit. But a contract must stay
  two-sided for most of a 30-minute window (150 of ~180 samples). Today 79% of weather contracts
  are one-sided, and our one weather pot got 3% valid samples. Expect weather pots to refund at
  close unless they are created for next-day events while both sides are still quoted, and the
  spread hovers right at the $0.05 edge.
- **Standard on economics: only on a few contracts.** The Fed market meets it on "maintains rate"
  and "Hike >25bps", not on "Hike 25bps" ($0.06 wide). Unemployment and GDP monthly releases have
  no book at all.
- **Size is not the binding constraint, presence and spread are.** 50 contracts at ~$0.50 is about
  $25 a side, which is also why manipulation is cheap (relevant to F2's pot cap).

## Suggestions (not implemented; for F1/F2 decisions)
1. Show a market as unavailable when either side of its book is empty, with that reason, and only
   offer contracts that pass the template's own spread and size rules at selection time.
2. Prefer next-day weather events and the tail buckets ("or above", "or below"), which are two-sided
   more often and read naturally as promises ("paid when Austin is very likely to hit 58°F or above").
3. Consider a weather-specific standard window (e.g. 10 minutes, 60 valid samples) so a briefly
   one-sided book does not void a whole window. That changes trigger parameters and needs your
   decision.
4. Label economics markets with no book as "no market maker right now" rather than hiding them, as
   the spec asks for empty categories.

Raw data: one JSON snapshot per contract (scratchpad, not committed); rerunnable with the same
public endpoints.

## All categories (F1 catalogue, 2026-11-15 19:45 UTC)

Since F1 the app measures every active Gemini contract continuously (`relay/src/catalog.ts`): the
events list over REST (50 events a request, the whole list in about two minutes), order books over
Gemini's public WebSocket (`depth5`, 150 contracts per step), each judged against the rule its pot
would get (demo under two hours to close, standard otherwise). The live view is
[`/markets`](https://honorcat.vercel.app/markets); this is a snapshot of it.

| Category | Events | Contracts | Work now (works + borderline) | Median spread | Median depth near the price |
|---|---|---|---|---|---|
| Sports | 886 | 13,165 | 1,538 | 5¢ | $22 |
| Crypto | 94 | 380 | 153 | 4¢ | $123 |
| Politics | 21 | 215 | 98 | 4¢ | $10 |
| Weather | 98 | 644 | 79 | 5¢ | $8 |
| Economics | 11 | 120 | 38 | 4¢ | $7 |
| Tech | 3 | 10 | 3 | 4¢ | $18 |
| Business | 6 | 28 | 3 | 5¢ | $9 |
| Commodities | 18 | 184 | 1 | 20¢ | $6 |
| Culture | 3 | 43 | 0 | 5¢ | $13 |

Depth is the dollars resting within 5¢ of the mid on the thinner side, over at most five levels.
Gemini's categories "Live", "Pro Football", "Economy", "Fun/Culture", "Media", "Other" and "Finance"
either overlap these (an event carries one category) or had no active events.

Main reasons a contract does not work: a one-sided book (most common in Weather, Economics and
Politics), a spread over the limit (Weather, Commodities) and, for short crypto markets under the
demo rule, too few contracts at the best price. Weather has improved since the F0 snapshot because
tomorrow's events are now quoted on both sides; it changes through the day.

**What this means for the defaults.** The rules can be met on a meaningful share of markets in every
category except Commodities and Culture right now, but "works now" is a snapshot: a book that is
two-sided now can go one-sided within the 30-minute standard window, which then needs a new window
before the pot can pay. The creation check reads the book live and refuses a market that fails, so
a pot is never created on a market that cannot pass at that moment. Depth near the price is small
almost everywhere (tens of dollars), which matters for F2's pot cap.
