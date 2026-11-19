import { bookQueue, bookStats, refreshStep, saveBook } from "./catalog";
import type { Db } from "./db";
import { depthSnapshot, GEMINI_REST } from "./gemini";

/**
 * One bounded step of the market catalogue: a few pages of Gemini's events list over REST, then up
 * to 150 order books over one WebSocket. A lease in relay_state keeps it to one step every two
 * minutes across all hosts (the worker runs it; the website only when no worker is configured).
 * Markets are offered only with a book read in the last 15 minutes, so this must keep running.
 */
const LEASE = "catalog_lease";
export const CATALOG_STEP_EVERY_MS = 120_000;

async function fetchJson(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(GEMINI_REST + path, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (r.status === 404) return null;
      if (r.status === 429) return null; // back off: the next step tries again
      const text = await r.text();
      if (!r.ok) throw new Error(`Gemini ${r.status}`);
      return JSON.parse(text); // the public API sometimes answers "upstream connect error" as text
    } catch {
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  return null;
}

export async function catalogTick(db: Db) {
  const now = Date.now();
  const lease = await db.query(
    `INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
     WHERE relay_state.value::bigint < $3 RETURNING key`,
    [LEASE, String(now), String(now - CATALOG_STEP_EVERY_MS)],
  );
  if (!lease.length) return null;
  const step = await refreshStep(db, fetchJson, { bookBudget: 0 });
  const queue = await bookQueue(db, Date.now(), 150, 20 * 60_000);
  const books = await depthSnapshot(
    queue.map((r) => r.symbol),
    4000,
  );
  for (const [symbol, raw] of books) await saveBook(db, symbol, bookStats(raw, Date.now()));
  return { ...step, books: books.size };
}
