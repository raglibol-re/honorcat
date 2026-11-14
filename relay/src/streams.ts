import { publicClient } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";

/**
 * Observability for the QuickNode Streams path.
 *
 * QuickNode runs our filter on every new Arc block range and POSTs the result to
 * /api/webhooks/quicknode. Each verified delivery is recorded here with its block range and the
 * delay between the block's timestamp and its arrival, so the UI can show the push pipeline live
 * and compare it with the RPC poller (chain_events.source records which path saw an event first).
 */

export type BatchInput = {
  start: bigint | null;
  end: bigint | null;
  bytes: number;
  gzip: boolean;
  logs: number;
  inserted: number;
  events: { name: string; potId: string | null; block?: string }[];
};

export async function recordBatch(db: Db, b: BatchInput): Promise<void> {
  let blockTime: number | null = null;
  if (b.end !== null) {
    try {
      const block = await publicClient().getBlock({ blockNumber: b.end });
      blockTime = Number(block.timestamp);
    } catch {
      blockTime = null; // RPC hiccup: keep the batch, skip the latency
    }
  }
  const latency = blockTime !== null ? Math.max(0, Date.now() - blockTime * 1000) : null;
  await db.query(
    `INSERT INTO stream_batches (batch_start, batch_end, block_time, latency_ms, bytes, gzip, logs, inserted, events)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      b.start?.toString() ?? null,
      b.end?.toString() ?? null,
      blockTime,
      latency,
      b.bytes,
      b.gzip,
      b.logs,
      b.inserted,
      JSON.stringify(b.events),
    ],
  );
  // Keep the table small: the UI only needs recent history.
  await db.query("DELETE FROM stream_batches WHERE id < (SELECT max(id) - 5000 FROM stream_batches)");
}

type BatchRow = {
  id: string;
  received_at: string;
  batch_start: string | null;
  batch_end: string | null;
  latency_ms: number | null;
  bytes: number;
  gzip: boolean;
  logs: number;
  inserted: number;
  events: { name: string; potId: string | null; block?: string }[];
};

export async function streamsOverview(db: Db, opts: { since?: number } = {}) {
  const cfg = getConfig();
  const [head, batches, stats, sources, recent] = await Promise.all([
    publicClient()
      .getBlock({ blockTag: "latest" })
      .then((b) => ({ number: b.number.toString(), timestamp: Number(b.timestamp) }))
      .catch(() => null),
    db.query<BatchRow>(
      `SELECT id::text AS id, received_at, batch_start::text AS batch_start, batch_end::text AS batch_end,
         latency_ms, bytes, gzip, logs, inserted, events
       FROM stream_batches WHERE id > $1 ORDER BY id DESC LIMIT 60`,
      [opts.since ?? 0],
    ),
    db.query<{ n: string; blocks: string | null; avg: string | null; p50: string | null; p95: string | null; logs: string | null; bytes: string | null }>(
      `SELECT count(*)::text AS n,
         (max(batch_end) - min(coalesce(batch_start, batch_end)) + 1)::text AS blocks,
         avg(latency_ms)::int::text AS avg,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::int::text AS p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int::text AS p95,
         sum(logs)::text AS logs, sum(bytes)::text AS bytes
       FROM stream_batches WHERE received_at > now() - interval '5 minutes'`,
    ),
    db.query<{ source: string; n: string }>("SELECT source, count(*)::text AS n FROM chain_events GROUP BY source"),
    db.query<{ event_name: string; pot_id: string | null; source: string; block_number: string; block_time: string | null; inserted_at: string; tx_hash: string }>(
      `SELECT event_name, pot_id::text AS pot_id, source, block_number::text AS block_number,
         block_time::text AS block_time, inserted_at, tx_hash
       FROM chain_events ORDER BY block_number DESC, log_index DESC LIMIT 12`,
    ),
  ]);
  const s = stats[0];
  const last = batches[0];
  return {
    configured: Boolean(cfg.streamsToken),
    primary: cfg.indexerPrimary,
    vault: cfg.vault,
    head,
    lastBatch: last ? { receivedAt: new Date(last.received_at).toISOString(), end: last.batch_end } : null,
    behindBlocks: head && last?.batch_end ? (BigInt(head.number) - BigInt(last.batch_end)).toString() : null,
    last5m: {
      batches: Number(s?.n ?? 0),
      blocks: s?.blocks ? Number(s.blocks) : 0,
      avgLatencyMs: s?.avg ? Number(s.avg) : null,
      p50LatencyMs: s?.p50 ? Number(s.p50) : null,
      p95LatencyMs: s?.p95 ? Number(s.p95) : null,
      vaultLogs: Number(s?.logs ?? 0),
      bytes: Number(s?.bytes ?? 0),
    },
    batches: batches.map((b) => ({
      id: Number(b.id),
      receivedAt: new Date(b.received_at).toISOString(),
      start: b.batch_start,
      end: b.batch_end,
      latencyMs: b.latency_ms,
      bytes: b.bytes,
      gzip: b.gzip,
      logs: b.logs,
      inserted: b.inserted,
      events: b.events,
    })),
    sources: Object.fromEntries(sources.map((r) => [r.source, Number(r.n)])),
    recentEvents: recent.map((e) => ({
      name: e.event_name,
      potId: e.pot_id,
      source: e.source,
      block: e.block_number,
      txHash: e.tx_hash,
      // how long after the block the event entered the index, via whichever path was first
      indexLagMs: e.block_time ? Math.max(0, new Date(e.inserted_at).getTime() - Number(e.block_time) * 1000) : null,
    })),
  };
}
