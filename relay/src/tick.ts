import { randomUUID } from "node:crypto";
import { publicClient } from "./chain";
import { getConfig } from "./config";
import { getDb, setState, type Db } from "./db";
import { pollLogs } from "./indexer/rpcPoller";
import { processOpenPots, type ActionReport } from "./resolver";
import { GeminiSource } from "./sources/gemini";
import { ManualSource } from "./sources/manual";
import type { ResultSource } from "./sources/types";

export type TickReport = {
  ran: boolean;
  reason: string;
  indexed?: { from: string; to: string; inserted: number } | null;
  actions?: ActionReport[];
  errors: string[];
  ms: number;
};

/** Registry of result sources. New adapters are added here. */
export function buildSources(db: Db): Record<string, ResultSource> {
  const sources: ResultSource[] = [new ManualSource(db), new GeminiSource(db, getConfig().geminiBase)];
  return Object.fromEntries(sources.map((s) => [s.name, s]));
}

/**
 * One relay step: index new logs (when RPC polling is primary), then resolve/expire due pots.
 * Guarded by a lease row so concurrent serverless invocations never double-submit, and
 * rate-limited by TICK_MIN_INTERVAL_MS unless `force` is set.
 */
export async function runTick(opts: { reason: string; force?: boolean; skipIndex?: boolean }): Promise<TickReport> {
  const started = Date.now();
  const cfg = getConfig();
  const db = await getDb();
  const holder = randomUUID();
  const minInterval = opts.force ? 0 : cfg.tickMinIntervalMs;

  const lease = await db.query(
    `UPDATE relay_lease SET holder = $1, until = now() + interval '90 seconds', last_start = now()
     WHERE id = 1 AND until < now() AND last_start < now() - ($2::int * interval '1 millisecond')
     RETURNING id`,
    [holder, minInterval],
  );
  if (lease.length === 0) return { ran: false, reason: opts.reason, errors: [], ms: Date.now() - started };

  const report: TickReport = { ran: true, reason: opts.reason, errors: [], ms: 0 };
  try {
    if (cfg.indexerPrimary === "rpc" && !opts.skipIndex) {
      try {
        const r = await pollLogs(db, publicClient(), cfg.vault, cfg.deployBlock, { deadlineMs: 20_000 });
        report.indexed = r && { from: r.from.toString(), to: r.to.toString(), inserted: r.inserted };
      } catch (err) {
        report.errors.push(`index: ${(err as Error).message.split("\n")[0]}`);
      }
    }
    if (cfg.resolverKey) {
      try {
        report.actions = await processOpenPots(db, buildSources(db));
      } catch (err) {
        report.errors.push(`resolve: ${(err as Error).message.split("\n")[0]}`);
      }
    }
    await setState(db, "last_tick", JSON.stringify({ at: new Date().toISOString(), reason: opts.reason }));
  } finally {
    await db.query("UPDATE relay_lease SET until = now(), holder = NULL WHERE id = 1 AND holder = $1", [holder]);
  }
  report.ms = Date.now() - started;
  return report;
}
