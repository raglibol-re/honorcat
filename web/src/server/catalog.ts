import "server-only";
import { catalog, depthSnapshot, GEMINI_REST, readBook, type CatalogRow, type Db, type Quality } from "@honorcat/relay";

/**
 * Web side of the market catalogue (relay/src/catalog.ts): runs bounded refresh steps under a
 * lease and serves filtered, quality-sorted lists. Gemini allows 120 public requests a minute per
 * client; the samplers need most of that, so one step (at most 4 list pages + 4 books) runs at most
 * every 15 s: about 32 requests a minute at the very most.
 */
const LEASE = "catalog_lease";
const STEP_EVERY_MS = 15_000;

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

/** One refresh step if none ran in the last 15 s (lease in relay_state); otherwise nothing. */
export async function catalogTick(db: Db) {
  const now = Date.now();
  const lease = await db.query(
    `INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
     WHERE relay_state.value::bigint < $3 RETURNING key`,
    [LEASE, String(now), String(now - STEP_EVERY_MS)],
  );
  if (!lease.length) return null;
  // Events list over REST (a few pages); order books over one WebSocket (no REST budget used).
  const step = await catalog.refreshStep(db, fetchJson, { bookBudget: 0 });
  const queue = await catalog.bookQueue(db, Date.now(), 150);
  const books = await depthSnapshot(queue.map((r) => r.symbol), 4000);
  for (const [symbol, raw] of books) await catalog.saveBook(db, symbol, catalog.bookStats(raw, Date.now()));
  return { ...step, books: books.size };
}

export type CatalogItem = CatalogRow & { quality: Quality };

export type CatalogQuery = { category?: string | null; withinH?: number | null; q?: string | null; usable?: boolean; limit?: number; offset?: number };

// The whole catalogue is thousands of rows: classify it once per 10 s per instance, not per request.
let snapshot: { at: number; all: { row: CatalogRow; q: Quality }[] } | null = null;

async function classified(db: Db) {
  const now = Date.now();
  if (snapshot && now - snapshot.at < 10_000) return snapshot;
  snapshot = { at: now, all: (await catalog.allRows(db, now)).map((row) => ({ row, q: catalog.classify(row, now) })) };
  return snapshot;
}

export async function catalogList(db: Db, query: CatalogQuery = {}) {
  const { at: now, all } = await classified(db);
  const summary = catalog.summarize(all);
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = all
    .filter((x) => !query.category || x.row.category === query.category)
    .filter((x) => !query.withinH || x.row.closeMs - now <= query.withinH * 3600_000)
    .filter((x) => !query.usable || x.q.status === "works" || x.q.status === "borderline")
    .filter((x) => words.every((w) => `${x.row.eventTitle} ${x.row.label} ${x.row.category} ${x.row.subcategory ?? ""}`.toLowerCase().includes(w)))
    .sort(catalog.compareRows);
  const offset = query.offset ?? 0;
  const limit = Math.min(200, query.limit ?? 60);
  return {
    total: filtered.length,
    items: filtered.slice(offset, offset + limit).map((x): CatalogItem => ({ ...x.row, quality: x.q })),
    summary,
    categories: summary.map((s) => s.category),
    lastSweep: await catalog.lastSweep(db),
    at: now,
  };
}

/* ------------------------------------------------------------------ live reading of one contract */

const quotes = new Map<string, { at: number; book: catalog.BookStats }>();

/** The contract's order book now (cached 5 s), its quality under the rule its pot would get. */
export async function liveQuality(db: Db, symbol: string, fallback?: CatalogRow | null, profile?: catalog.Profile): Promise<{ row: CatalogRow | null; book: catalog.BookStats | null; quality: Quality | null }> {
  const hit = quotes.get(symbol);
  let book = hit && Date.now() - hit.at < 5000 ? hit.book : null;
  if (!book) {
    const raw = await readBook(symbol);
    if (raw) {
      book = catalog.bookStats(raw, Date.now());
      quotes.set(symbol, { at: Date.now(), book });
      await catalog.saveBook(db, symbol, book).catch(() => {});
    }
  }
  const row = (await catalog.rowBySymbol(db, symbol)) ?? fallback ?? null;
  if (!row || !book) return { row, book, quality: null };
  return { row, book, quality: catalog.classify({ ...row, book }, Date.now(), { profile }) };
}
