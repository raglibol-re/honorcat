# Streams backfill after downtime: a recorded run (2026-11-16)

**Question.** If the QuickNode Stream stops delivering for a while, do the pot events of that time
still arrive through Streams afterwards, or only through the RPC poller?

**Run.**

1. 10:10:28 UTC, head block 72,543,233: stream paused (`relay/scripts/quicknode-stream.ts --status paused`).
2. While paused, a full pot ran on Arc testnet (`pots-e2e.ts --scenario exit`): pot 9 created
   (tx 0x1c987bc6…2df3), joined at 68.5% and divided at the median of three averages checked by the
   MedianResolver (tx 0x82a9d216…74c8). The RPC poller kept the pages current meanwhile.
3. 10:12:45 UTC, head block 72,543,433: stream resumed (`--status active`).

**Result** (`/api/streams`, batches whose block falls in the paused range):

| Block | Received (UTC) | Delay | Size |
|---|---|---|---|
| 72543240 | 10:10:33 | 2.1 s | heartbeat (before the pause took effect) |
| 72543260 | 10:12:59 | 134.1 s | heartbeat |
| 72543280 | 10:12:59 | 120.3 s | heartbeat |
| 72543294 | 10:12:59 | 109.6 s | 3,173 bytes: pot 9 events |
| 72543298 | 10:12:59 | 107.9 s | 2,399 bytes: pot 9 events |
| 72543300 to 72543340 | 10:12:59 to 10:13:00 | 107 to 79 s | heartbeats |
| 72543350 | 10:13:00 | 74.5 s | 4,428 bytes: pot 9 events |
| 72543354 | 10:13:00 | 68.7 s | 2,464 bytes: pot 9 events |
| 72543360 to 72543400 | 10:13:00 to 10:13:01 | 66 to 37 s | heartbeats |
| 72543406 | 10:13:01 | 34.5 s | 3,980 bytes: pot 9 events |
| 72543420 | 10:13:01 | 23.6 s | heartbeat |

Every heartbeat (each 20th block) and every block with a pot event in the paused range was
delivered within 16 seconds of resuming, in block order. QuickNode keeps the stream's position
and replays from it; nothing was skipped. The webhook stores pot events idempotently
(`ON CONFLICT DO NOTHING` on transaction and log index), so events the RPC poller had already
recorded are not duplicated; the poller and Streams agree.

**What this does not cover.** A pause longer than QuickNode's retention, or a change of the
stream's start block, would need the RPC poller (which resumes from its own stored block) or a new
stream starting at the gap.
