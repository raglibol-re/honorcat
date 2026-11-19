import { randomUUID } from "node:crypto";
import { publicClient } from "./chain";
import { getConfig } from "./config";
import { getDb, setState, type Db } from "./db";
import { pollLogs } from "./indexer/rpcPoller";
import { processOpenPots, type ActionReport } from "./resolver";
import { processEarly, type EarlyAction } from "./early";
import { indexPots, potsHousekeeping } from "./pots";
import { refillPool } from "./funding";
import { privateKeyToAccount } from "viem/accounts";
import { GeminiSource } from "./sources/gemini";
import { ManualSource } from "./sources/manual";
import type { ResultSource } from "./sources/types";

export type TickReport = {
  ran: boolean;
  reason: string;
  indexed?: { from: string; to: string; inserted: number } | null;
  actions?: ActionReport[];
  early?: EarlyAction[];
  pots?: unknown;
  errors: string[];
  ms: number;
};

/** Registry of result sources. New adapters are added here. */
export function buildSources(db: Db): Record<string, ResultSource> {
  const cfg = getConfig();
  const sources: ResultSource[] = [
    new ManualSource(db),
    new GeminiSource(db, cfg.geminiBase),
  ];
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
        const r = await pollLogs(db, publicClient(), cfg.vault, cfg.deployBlock, {
          deadlineMs: 20_000,
          book: cfg.guarantees?.book ?? null,
          merkle: cfg.merkle?.book ?? null,
        });
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
      try {
        report.early = await processEarly(db);
      } catch (err) {
        report.errors.push(`early: ${(err as Error).message.split("\n")[0]}`);
      }
    }
    if (cfg.pots && cfg.resolverKey) {
      // Each step on its own: one failing step (an RPC limit, a busy API) must not skip the others,
      // and its error names the step.
      const step = async <T,>(name: string, f: () => Promise<T>): Promise<T | null> => {
        try {
          return await f();
        } catch (err) {
          report.errors.push(`${name}: ${(err as Error).message.split(String.fromCharCode(10))[0]}`);
          return null;
        }
      };
      const own = cfg.samplerKey ? privateKeyToAccount(cfg.samplerKey as `0x${string}`) : null;
      const indexed = await step("pots index", () => indexPots(db, { deadlineMs: 15_000 }));
      const house = await step("pots housekeeping", () => potsHousekeeping(db, own));
      if (indexed?.touched || house?.calls) report.pots = { indexed, house };
      const head = await step("head", async () => (await publicClient().getBlockNumber()) - 5n);
      if (head !== null) {
        // Perps: index the chain contract, then start first ropes, credit and roll (perps.ts).
        const { indexPerps, perpsHousekeeping } = await import("./perps");
        await step("perps index", () => indexPerps(db, head, { deadlineMs: 8_000 }));
        const perpsHouse = await step("perps housekeeping", () => perpsHousekeeping(db, own));
        if (perpsHouse?.calls) (report as Record<string, unknown>).perps = perpsHouse;
        // Group pots: index, open each batch's price window, fail stuck batches, settle (groups.ts).
        if (cfg.groups) {
          const { indexGroups, groupsHousekeeping } = await import("./groups");
          await step("groups index", () => indexGroups(db, head, { deadlineMs: 6_000 }));
          const groupsHouse = await step("groups housekeeping", () => groupsHousekeeping(db, own));
          if (groupsHouse?.calls) (report as Record<string, unknown>).groups = groupsHouse;
        }
      }
    }
    // Honor: recomputed from the events at most once an hour, behind HONOR=on (honor/store.ts).
    await (await import("./honor/store")).honorHousekeeping(db).catch((err) => report.errors.push(`honor: ${(err as Error).message.split(String.fromCharCode(10))[0]}`));
    // The test-money pool refills itself from Circle's faucet API (at most every 3 hours).
    await refillPool(db).catch((err) => report.errors.push(`refill: ${(err as Error).message.split(String.fromCharCode(10))[0]}`));
    await setState(db, "last_tick", JSON.stringify({ at: new Date().toISOString(), reason: opts.reason }));
  } finally {
    await db.query("UPDATE relay_lease SET until = now(), holder = NULL WHERE id = 1 AND holder = $1", [holder]);
  }
  report.ms = Date.now() - started;
  return report;
}
