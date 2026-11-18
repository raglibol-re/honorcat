import "server-only";
import { catalog, depthSnapshot, GEMINI_REST, readBook, type CatalogRow, type CategorySummary, type Db, type Quality } from "@honorcat/relay";

/**
 * Web side of the market catalogue (relay/src/catalog.ts): runs bounded refresh steps under a
 * lease and serves filtered, quality-sorted lists. Gemini allows 120 public requests a minute per
 * client; the samplers need most of that, so one step (at most 4 list pages + 4 books) runs at most
 * every 15 s: about 32 requests a minute at the very most.
 */
const LEASE = "catalog_lease";
// One catalogue step every two minutes across all instances (database traffic is the free tier's limit).
const STEP_EVERY_MS = 120_000;

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
  const queue = await catalog.bookQueue(db, Date.now(), 150, 20 * 60_000);
  const books = await depthSnapshot(queue.map((r) => r.symbol), 4000);
  for (const [symbol, raw] of books) await catalog.saveBook(db, symbol, catalog.bookStats(raw, Date.now()));
  return { ...step, books: books.size };
}

export type CatalogItem = CatalogRow & { quality: Quality };

export type CatalogQuery = { category?: string | null; withinH?: number | null; q?: string | null; usable?: boolean; even?: boolean; limit?: number; offset?: number };

/** The middle of the best buy and sell price (the order book's when read), 0..1. */
const midOf = (r: CatalogRow): number | null => {
  const b = r.book?.bid ?? r.bid;
  const a = r.book?.ask ?? r.ask;
  return b !== null && b !== undefined && a !== null && a !== undefined ? (b + a) / 2 : null;
};

type Rated = { row: CatalogRow; q: Quality };

/** Whether a rated row matches the page's filters (the same filters as the SQL, applied in memory). */
function matches(x: Rated, query: CatalogQuery, now: number) {
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (query.category && x.row.category !== query.category) return false;
  if (query.withinH && x.row.closeMs - now > query.withinH * 3600_000) return false;
  if (query.even) {
    // Even markets: contracts near 50%, where neither side is the favourite.
    const m = midOf(x.row);
    if (m === null || m < 0.4 || m > 0.6) return false;
  }
  return words.every((w) => `${x.row.eventTitle} ${x.row.label} ${x.row.category} ${x.row.subcategory ?? ""}`.toLowerCase().includes(w));
}

// The whole catalogue is ~24,000 contracts (~16 MB): it is never read in one piece (every byte read
// counts against the database's monthly transfer). Usable contracts (a fresh book within the looser
// rule: a few hundred at most) are read and rated at most every five minutes per instance; any other
// listing reads only the rows it shows, filtered in SQL.
let usable: { at: number; all: Rated[] } | null = null;
async function usableAll(db: Db, now: number) {
  if (usable && now - usable.at < 300_000) return usable.all;
  const rows = await catalog.queryRows(db, now, { usable: true }, 3000);
  const all = rows.map((row) => ({ row, q: catalog.classify(row, now) })).filter((x) => x.q.status === "works" || x.q.status === "borderline");
  usable = { at: now, all };
  return all;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

let summaryCache: { at: number; summary: CategorySummary[] } | null = null;
async function summaryOf(db: Db, now: number): Promise<CategorySummary[]> {
  if (summaryCache && now - summaryCache.at < 300_000) return summaryCache.summary;
  const [counts, ok] = await Promise.all([catalog.categoryCounts(db, now), usableAll(db, now)]);
  const summary = counts
    .map((c) => {
      const xs = ok.filter((x) => x.row.category === c.category);
      return {
        category: c.category,
        events: c.events,
        contracts: c.contracts,
        works: xs.filter((x) => x.q.status === "works").length,
        borderline: xs.filter((x) => x.q.status === "borderline").length,
        medianSpread: c.medianSpread,
        medianDepthUsd: median(xs.map((x) => x.q.minDepthUsd).filter((v): v is number => v !== null)),
      };
    })
    .sort((a, b) => b.works + b.borderline - (a.works + a.borderline) || b.contracts - a.contracts);
  summaryCache = { at: now, summary };
  return summary;
}

export async function catalogList(db: Db, query: CatalogQuery = {}) {
  const now = Date.now();
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(200, query.limit ?? 60);
  let total: number;
  let page: Rated[];
  if (query.usable) {
    const all = (await usableAll(db, now)).filter((x) => matches(x, query, now)).sort(catalog.compareRows);
    total = all.length;
    page = all.slice(offset, offset + limit);
  } else {
    const filter = { category: query.category, withinH: query.withinH, q: query.q, even: query.even };
    const [rows, n] = await Promise.all([catalog.queryRows(db, now, filter, Math.min(offset + limit + 200, 1000)), catalog.countRows(db, now, filter)]);
    page = rows
      .map((row) => ({ row, q: catalog.classify(row, now) }))
      .sort(catalog.compareRows)
      .slice(offset, offset + limit);
    total = n;
  }
  const summary = await summaryOf(db, now);
  return {
    total,
    items: page.map((x): CatalogItem => ({ ...x.row, quality: x.q })),
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
