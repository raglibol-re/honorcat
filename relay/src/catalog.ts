/**
 * Market catalogue: every active Gemini prediction contract, measured against the trigger's own
 * rules, so funders can pick any market that will actually work and see why others will not.
 *
 * Two sources, both public and documented (developer.gemini.com):
 * - the events list (`/v1/prediction-markets/events`): per contract `prices.bestBid`,
 *   `prices.bestAsk` (absent on an empty side), `expiryDate`, `marketState`; per event `volume24h`.
 *   Cheap: 50 events per request, so the whole catalogue is a few dozen requests.
 * - the order book (`/v1/book/{instrumentSymbol}`): size at the best prices and depth near the mid.
 *   One request per contract, so it is read only for contracts whose listed spread could pass.
 *
 * Quality uses exactly the rule a pot on that contract would get (the profile chosen from its time
 * to close), so "works" here means the samplers' checks can pass on the book as it is now.
 */
import { MIN_LEAD_MS, PROFILE_CUTOFF_MS, PROVISIONAL_DEFAULTS } from "./trigger/params";
import type { Db } from "./db";

export type Profile = keyof typeof PROVISIONAL_DEFAULTS;

// Rule constants live with the trigger rules (trigger/params.ts).
export { PROFILE_CUTOFF_MS, MIN_LEAD_MS };
/** Depth counts resting size within this distance of the midpoint (USD per contract). */
export const DEPTH_BAND = 0.05;

export function profileFor(closeMs: number, nowMs: number): Profile {
  return closeMs - nowMs < PROFILE_CUTOFF_MS ? "demo" : "standard";
}

export type BookStats = {
  at: number; // ms, when the book was read
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  bidDepth: number; // contracts within DEPTH_BAND below the mid (or below the best bid if one-sided)
  askDepth: number;
  bidDepthUsd: number;
  askDepthUsd: number;
};

export type CatalogRow = {
  symbol: string; // Gemini instrumentSymbol
  eventTicker: string;
  contractTicker: string;
  category: string;
  subcategory: string | null;
  eventTitle: string;
  label: string;
  closeMs: number;
  marketState: string | null;
  bid: number | null; // from the events list
  ask: number | null;
  eventVolume24h: number | null; // USD, per event (Gemini publishes no per-contract figure)
  image: string | null;
  seenAt: number; // ms, last time the events list included it
  book: BookStats | null;
};

export type Status = "works" | "borderline" | "unmeasured" | "unavailable";
export type Quality = { status: Status; profile: Profile; reasons: string[]; spread: number | null; minSize: number | null; minDepthUsd: number | null };

const cents = (x: number) => `${Math.round(x * 100)}¢`;

/**
 * The verdict for one contract at `now`. Uses the order book when it was read within `bookMaxAgeMs`,
 * otherwise only the listed prices (and then size is unknown: "unmeasured" at best).
 */
export function classify(r: CatalogRow, now: number, opts: { bookMaxAgeMs?: number; profile?: Profile } = {}): Quality {
  const bookMaxAgeMs = opts.bookMaxAgeMs ?? 15 * 60_000;
  // A pot's own rule wins (Quick demo always uses the demo rule); otherwise it follows time to close.
  const profile = opts.profile ?? profileFor(r.closeMs, now);
  const rule = PROVISIONAL_DEFAULTS[profile];
  const maxSpread = Number(rule.maxSpreadUsd);
  const minSize = Number(rule.minSizeContracts);
  const fresh = r.book && now - r.book.at <= bookMaxAgeMs ? r.book : null;
  const bid = fresh ? fresh.bid : r.bid;
  const ask = fresh ? fresh.ask : r.ask;
  const reasons: string[] = [];
  if (r.marketState && r.marketState !== "open") reasons.push("trading is paused");
  if (r.closeMs - now < MIN_LEAD_MS) reasons.push("closes in under 4 minutes");
  if (bid === null && ask === null) reasons.push("no quotes on either side");
  else if (bid === null || ask === null) reasons.push(`one-sided book (no ${bid === null ? "buyers" : "sellers"})`);
  const spread = bid !== null && ask !== null ? Math.round((ask - bid) * 10_000) / 10_000 : null;
  if (spread !== null && spread < 0) reasons.push("crossed book");
  else if (spread !== null && spread > maxSpread + 1e-9) reasons.push(`spread ${cents(spread)} is over the ${cents(maxSpread)} limit`);
  const sizes = fresh && fresh.bidSize !== null && fresh.askSize !== null ? Math.min(fresh.bidSize, fresh.askSize) : null;
  if (sizes !== null && sizes < minSize) reasons.push(`only ${trim(sizes)} contracts at the best price (needs ${minSize})`);
  const minDepthUsd = fresh ? Math.min(fresh.bidDepthUsd, fresh.askDepthUsd) : null;
  if (reasons.length) return { status: "unavailable", profile, reasons, spread, minSize: sizes, minDepthUsd };
  if (sizes === null) return { status: "unmeasured", profile, reasons: ["depth not measured yet"], spread, minSize: null, minDepthUsd: null };
  const edge: string[] = [];
  if (spread !== null && spread > maxSpread - 0.01 + 1e-9) edge.push(`spread ${cents(spread)} is at the limit`);
  if (sizes < 2 * minSize) edge.push(`thin: ${trim(sizes)} contracts at the best price`);
  return { status: edge.length ? "borderline" : "works", profile, reasons: edge, spread, minSize: sizes, minDepthUsd };
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

const RANK: Record<Status, number> = { works: 0, borderline: 1, unmeasured: 2, unavailable: 3 };

/** Sort key: works first, then tighter spread, deeper book, sooner close. */
export function compareRows(a: { row: CatalogRow; q: Quality }, b: { row: CatalogRow; q: Quality }) {
  return (
    RANK[a.q.status] - RANK[b.q.status] ||
    (a.q.spread ?? 9) - (b.q.spread ?? 9) ||
    (b.q.minDepthUsd ?? -1) - (a.q.minDepthUsd ?? -1) ||
    a.row.closeMs - b.row.closeMs
  );
}

/** Book statistics from a raw `/v1/book` response. */
export function bookStats(raw: { bids?: { price: string; amount: string }[]; asks?: { price: string; amount: string }[] }, at: number): BookStats {
  const bids = (raw.bids ?? []).map((x) => [Number(x.price), Number(x.amount)] as const).sort((p, q) => q[0] - p[0]);
  const asks = (raw.asks ?? []).map((x) => [Number(x.price), Number(x.amount)] as const).sort((p, q) => p[0] - q[0]);
  const bid = bids[0]?.[0] ?? null;
  const ask = asks[0]?.[0] ?? null;
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const near = (side: (readonly [number, number])[], inBand: (p: number) => boolean) => {
    const rows = side.filter(([p]) => inBand(p));
    return { n: rows.reduce((s, [, a]) => s + a, 0), usd: rows.reduce((s, [p, a]) => s + p * a, 0) };
  };
  const b = near(bids, (p) => (mid === null ? bid !== null && p >= bid - DEPTH_BAND : p >= mid - DEPTH_BAND));
  const a = near(asks, (p) => (mid === null ? ask !== null && p <= ask + DEPTH_BAND : p <= mid + DEPTH_BAND));
  return {
    at,
    bid,
    ask,
    bidSize: bids[0]?.[1] ?? null,
    askSize: asks[0]?.[1] ?? null,
    bidDepth: b.n,
    askDepth: a.n,
    // USD resting near the mid: price x size, per side.
    bidDepthUsd: Math.round(b.usd * 100) / 100,
    askDepthUsd: Math.round(a.usd * 100) / 100,
  };
}

/* ------------------------------------------------------------------ events list → rows */

type ListedContract = {
  ticker: string;
  label: string;
  status: string;
  marketState?: string | null;
  instrumentSymbol?: string;
  expiryDate?: string | null;
  prices?: { bestBid?: string; bestAsk?: string };
};
export type ListedEvent = {
  ticker: string;
  title: string;
  category: string;
  subcategory?: { name?: string } | string | null;
  status: string;
  expiryDate?: string | null;
  volume24h?: string | null;
  imageUrl?: string | null;
  contracts?: ListedContract[];
};

const num = (v?: string | null) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function rowsFromEvent(e: ListedEvent, now: number): Omit<CatalogRow, "book">[] {
  if (e.status !== "active") return [];
  const sub = typeof e.subcategory === "string" ? e.subcategory : (e.subcategory?.name ?? null);
  return (e.contracts ?? [])
    .filter((c) => c.status === "active" && c.instrumentSymbol)
    .map((c) => ({
      symbol: c.instrumentSymbol!,
      eventTicker: e.ticker,
      contractTicker: c.ticker,
      category: e.category,
      subcategory: sub,
      eventTitle: e.title,
      label: c.label,
      closeMs: new Date((c.expiryDate ?? e.expiryDate) || 0).getTime(),
      marketState: c.marketState ?? null,
      bid: num(c.prices?.bestBid),
      ask: num(c.prices?.bestAsk),
      eventVolume24h: num(e.volume24h),
      image: e.imageUrl ?? null,
      seenAt: now,
    }))
    .filter((r) => Number.isFinite(r.closeMs) && r.closeMs > now);
}

/* ------------------------------------------------------------------ storage */

// Table market_catalog is created with the rest of the schema (db.ts).

/** Upserts listed rows (keeps their last book reading). */
export async function upsertListed(db: Db, rows: Omit<CatalogRow, "book">[]) {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO market_catalog (symbol, category, close_ms, seen_at, listed)
     SELECT x->>'symbol', x->>'category', (x->>'closeMs')::bigint, (x->>'seenAt')::bigint, x
       FROM jsonb_array_elements($1::jsonb) AS x
     ON CONFLICT (symbol) DO UPDATE SET category = EXCLUDED.category, close_ms = EXCLUDED.close_ms,
       seen_at = EXCLUDED.seen_at, listed = EXCLUDED.listed`,
    [JSON.stringify(rows)],
  );
}

export async function saveBook(db: Db, symbol: string, book: BookStats) {
  await db.query("UPDATE market_catalog SET book = $2::jsonb, book_at = $3 WHERE symbol = $1", [symbol, JSON.stringify(book), book.at]);
}

/** Drops contracts that closed or that the events list stopped returning. */
export async function prune(db: Db, now: number, unseenMs = 30 * 60_000) {
  await db.query("DELETE FROM market_catalog WHERE close_ms < $1 OR seen_at < $2", [now, now - unseenMs]);
}

type DbRow = { listed: Omit<CatalogRow, "book"> | string; book: BookStats | string | null };
const parse = <T,>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
export const toRow = (r: DbRow): CatalogRow => ({ ...parse(r.listed), book: r.book ? parse(r.book) : null });

/**
 * Contracts that should get an order-book read next: still open, not closing within the lead
 * time, listed with both sides and a spread that could pass, book never read or older than
 * `staleMs`. Tightest spreads and soonest closes first.
 */
export async function bookQueue(db: Db, now: number, limit: number, staleMs = 10 * 60_000): Promise<CatalogRow[]> {
  const rows = await db.query<DbRow>(
    `SELECT listed, book FROM market_catalog
      WHERE close_ms > $1 AND (book_at IS NULL OR book_at < $2)
        AND (listed->>'bid') IS NOT NULL AND (listed->>'ask') IS NOT NULL
        AND (listed->>'ask')::numeric - (listed->>'bid')::numeric <= 0.05
      ORDER BY (listed->>'ask')::numeric - (listed->>'bid')::numeric, close_ms
      LIMIT $3`,
    [now + MIN_LEAD_MS, now - staleMs, limit],
  );
  return rows.map(toRow);
}

export async function allRows(db: Db, now: number): Promise<CatalogRow[]> {
  const rows = await db.query<DbRow>("SELECT listed, book FROM market_catalog WHERE close_ms > $1", [now]);
  return rows.map(toRow);
}

export async function rowBySymbol(db: Db, symbol: string): Promise<CatalogRow | null> {
  const rows = await db.query<DbRow>("SELECT listed, book FROM market_catalog WHERE symbol = $1", [symbol]);
  return rows[0] ? toRow(rows[0]) : null;
}

/* ------------------------------------------------------------------ summary */

export type CategorySummary = { category: string; events: number; contracts: number; works: number; borderline: number; medianSpread: number | null; medianDepthUsd: number | null };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function summarize(items: { row: CatalogRow; q: Quality }[]): CategorySummary[] {
  const by = new Map<string, { row: CatalogRow; q: Quality }[]>();
  for (const it of items) by.set(it.row.category, [...(by.get(it.row.category) ?? []), it]);
  return [...by.entries()]
    .map(([category, xs]) => ({
      category,
      events: new Set(xs.map((x) => x.row.eventTicker)).size,
      contracts: xs.length,
      works: xs.filter((x) => x.q.status === "works").length,
      borderline: xs.filter((x) => x.q.status === "borderline").length,
      medianSpread: median(xs.map((x) => x.q.spread).filter((v): v is number => v !== null)),
      medianDepthUsd: median(xs.map((x) => x.q.minDepthUsd).filter((v): v is number => v !== null)),
    }))
    .sort((a, b) => b.works + b.borderline - (a.works + a.borderline) || b.contracts - a.contracts);
}

/* ------------------------------------------------------------------ refresh step */

export type FetchJson = (path: string) => Promise<unknown>;

const CURSOR = "catalog_cursor";
const LAST_SWEEP = "catalog_last_sweep";
type Cursor = { cats: string[]; i: number; offset: number; started: number };

/**
 * One bounded refresh step: at most `listBudget` events-list pages (50 events each) and
 * `bookBudget` order books. Walks every category Gemini lists (from its categories endpoint),
 * page by page, and remembers where it stopped, so repeated calls sweep the whole catalogue while
 * staying far below Gemini's 120 public requests a minute. After a full sweep it prunes contracts
 * that closed or disappeared.
 */
export async function refreshStep(
  db: Db,
  fetchJson: FetchJson,
  opts: { now?: number; listBudget?: number; bookBudget?: number } = {},
): Promise<{ pages: number; books: number; rows: number; swept: boolean }> {
  const now = opts.now ?? Date.now();
  const listBudget = opts.listBudget ?? 4;
  const bookBudget = opts.bookBudget ?? 4;
  const state = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = $1", [CURSOR]);
  let cur: Cursor | null = state[0] ? (JSON.parse(state[0].value) as Cursor) : null;
  if (!cur || cur.i >= cur.cats.length) {
    const c = (await fetchJson("/v1/prediction-markets/categories")) as { categories?: string[] } | null;
    const cats = (c?.categories ?? []).filter((x) => typeof x === "string" && x.length > 0);
    cur = { cats, i: 0, offset: 0, started: now };
  }
  let pages = 0;
  let rows = 0;
  let swept = false;
  while (pages < listBudget && cur.i < cur.cats.length) {
    const cat = cur.cats[cur.i]!;
    const r = (await fetchJson(`/v1/prediction-markets/events?status=active&limit=50&offset=${cur.offset}&category=${encodeURIComponent(cat)}`)) as {
      data?: ListedEvent[];
      pagination?: { total?: number };
    } | null;
    pages++;
    const events = r?.data ?? [];
    const listed = events.flatMap((e) => rowsFromEvent(e, now));
    await upsertListed(db, listed);
    rows += listed.length;
    const total = r?.pagination?.total ?? 0;
    cur.offset += 50;
    if (!events.length || cur.offset >= total) {
      cur.i++;
      cur.offset = 0;
    }
  }
  if (cur.i >= cur.cats.length) {
    swept = true;
    await prune(db, now, Math.max(30 * 60_000, now - cur.started + 10 * 60_000));
    await db.query("INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [LAST_SWEEP, String(now)]);
  }
  await db.query("INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [CURSOR, JSON.stringify(cur)]);

  let books = 0;
  for (const row of await bookQueue(db, now, bookBudget)) {
    const raw = (await fetchJson(`/v1/book/${encodeURIComponent(row.symbol)}?limit_bids=0&limit_asks=0`)) as Parameters<typeof bookStats>[0] | null;
    if (!raw) continue;
    await saveBook(db, row.symbol, bookStats(raw, opts.now ?? Date.now()));
    books++;
  }
  return { pages, books, rows, swept };
}

export async function lastSweep(db: Db): Promise<number | null> {
  const r = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = $1", [LAST_SWEEP]);
  return r[0] ? Number(r[0].value) : null;
}
