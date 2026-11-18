import { describe, expect, it } from "vitest";
import { allRows, bookStats, categoryCounts, classify, compareRows, countRows, profileFor, queryRows, refreshStep, rowsFromEvent, summarize, type CatalogRow, type ListedEvent } from "../src/catalog";
import { memoryDb } from "../src/db";

const NOW = 1_800_000_000_000;
const H = 3600_000;

function row(over: Partial<CatalogRow> = {}): CatalogRow {
  return {
    symbol: "GEMI-X-1",
    eventTicker: "X",
    contractTicker: "C1",
    category: "Weather",
    subcategory: null,
    eventTitle: "Highest temperature?",
    label: "60°F or above",
    closeMs: NOW + 10 * H,
    marketState: "open",
    bid: 0.47,
    ask: 0.52,
    eventVolume24h: 0,
    image: null,
    seenAt: NOW,
    book: null,
    ...over,
  };
}
const book = (bid: number | null, ask: number | null, bidSize: number | null, askSize: number | null) => ({
  at: NOW,
  bid,
  ask,
  bidSize,
  askSize,
  bidDepth: bidSize ?? 0,
  askDepth: askSize ?? 0,
  bidDepthUsd: (bid ?? 0) * (bidSize ?? 0),
  askDepthUsd: (ask ?? 0) * (askSize ?? 0),
});

describe("trigger profile from time to close", () => {
  it("uses the demo rule under two hours and the standard rule from two hours", () => {
    expect(profileFor(NOW + H, NOW)).toBe("demo");
    expect(profileFor(NOW + 2 * H - 1, NOW)).toBe("demo");
    expect(profileFor(NOW + 2 * H, NOW)).toBe("standard");
  });
});

describe("quality", () => {
  it("works when both sides are quoted within the profile's spread and size", () => {
    const q = classify(row({ book: book(0.47, 0.5, 120, 150) }), NOW);
    expect(q).toMatchObject({ status: "works", profile: "standard", spread: 0.03, minSize: 120 });
  });
  it("is unavailable with the reason for a one-sided book", () => {
    const q = classify(row({ bid: null, ask: 0.99 }), NOW);
    expect(q.status).toBe("unavailable");
    expect(q.reasons).toContain("one-sided book (no buyers)");
  });
  it("is unavailable when the spread is over the profile's limit", () => {
    const q = classify(row({ book: book(0.85, 0.91, 400, 400) }), NOW);
    expect(q.status).toBe("unavailable");
    expect(q.reasons[0]).toBe("spread 6¢ is over the 5¢ limit");
  });
  it("applies the tighter demo limit close to the close", () => {
    const q = classify(row({ closeMs: NOW + H, book: book(0.5, 0.55, 400, 400) }), NOW);
    expect(q.profile).toBe("demo");
    expect(q.reasons[0]).toBe("spread 5¢ is over the 4¢ limit");
  });
  it("is unavailable when the best size is below the rule", () => {
    const q = classify(row({ book: book(0.47, 0.5, 20, 300) }), NOW);
    expect(q.reasons[0]).toBe("only 20 contracts at the best price (needs 50)");
  });
  it("is borderline at the edge of the rule", () => {
    expect(classify(row({ book: book(0.47, 0.52, 300, 300) }), NOW).status).toBe("borderline");
    expect(classify(row({ book: book(0.47, 0.49, 60, 300) }), NOW).status).toBe("borderline");
  });
  it("is unmeasured until the order book has been read, and ignores an old book", () => {
    expect(classify(row(), NOW).status).toBe("unmeasured");
    expect(classify(row({ book: { ...book(0.47, 0.5, 120, 150), at: NOW - 60 * 60_000 } }), NOW).status).toBe("unmeasured");
  });
  it("refuses markets that close too soon or are paused", () => {
    expect(classify(row({ closeMs: NOW + 60_000 }), NOW).reasons).toContain("closes in under 4 minutes");
    expect(classify(row({ marketState: "closed" }), NOW).reasons).toContain("trading is paused");
  });
  it("sorts working markets first, then by spread, depth and close", () => {
    const items = [
      row({ symbol: "a", book: book(0.47, 0.52, 300, 300) }),
      row({ symbol: "b", bid: null }),
      row({ symbol: "c", book: book(0.49, 0.5, 300, 300) }),
      row({ symbol: "d" }),
    ].map((r) => ({ row: r, q: classify(r, NOW) }));
    expect(items.sort(compareRows).map((x) => x.row.symbol)).toEqual(["c", "a", "d", "b"]);
  });
});

describe("book statistics", () => {
  it("reads best prices, sizes and depth within 5 cents of the mid", () => {
    const s = bookStats(
      {
        bids: [
          { price: "0.45", amount: "100" },
          { price: "0.47", amount: "50" },
          { price: "0.30", amount: "999" },
        ],
        asks: [
          { price: "0.50", amount: "70" },
          { price: "0.53", amount: "30" },
        ],
      },
      NOW,
    );
    expect(s).toMatchObject({ bid: 0.47, ask: 0.5, bidSize: 50, askSize: 70, bidDepth: 150, askDepth: 100 });
    expect(s.bidDepthUsd).toBeCloseTo(0.47 * 50 + 0.45 * 100);
  });
});

describe("events list", () => {
  it("keeps active contracts with an instrument and a future close; event category wins", () => {
    const e: ListedEvent = {
      ticker: "E",
      title: "T?",
      category: "Sports",
      status: "active",
      expiryDate: new Date(NOW + H).toISOString(),
      volume24h: "12.5",
      contracts: [
        { ticker: "A", label: "A", status: "active", instrumentSymbol: "GEMI-E-A", prices: { bestBid: "0.4", bestAsk: "0.45" } },
        { ticker: "B", label: "B", status: "settled", instrumentSymbol: "GEMI-E-B" },
        { ticker: "C", label: "C", status: "active" },
      ],
    };
    const rows = rowsFromEvent(e, NOW);
    expect(rows.map((r) => r.symbol)).toEqual(["GEMI-E-A"]);
    expect(rows[0]).toMatchObject({ category: "Sports", bid: 0.4, ask: 0.45, eventVolume24h: 12.5, closeMs: NOW + H });
  });
});

describe("refresh step", () => {
  it("sweeps every category page by page within its budget, reads books only where the spread can pass, prunes after a sweep", async () => {
    const db = await memoryDb();
    const ev = (cat: string, n: number, bid: string | undefined, ask: string) => ({
      ticker: `${cat}${n}`,
      title: `${cat} ${n}?`,
      category: cat,
      status: "active",
      expiryDate: new Date(NOW + 5 * H).toISOString(),
      contracts: [{ ticker: "Y", label: "Yes", status: "active", instrumentSymbol: `GEMI-${cat}${n}-Y`, prices: { bestBid: bid, bestAsk: ask } }],
    });
    const pages: Record<string, unknown> = {
      "/v1/prediction-markets/categories": { categories: ["Weather", "Economics"] },
      "/v1/prediction-markets/events?status=active&limit=50&offset=0&category=Weather": { data: [ev("Weather", 1, "0.47", "0.50"), ev("Weather", 2, undefined, "0.99")], pagination: { total: 51 } },
      "/v1/prediction-markets/events?status=active&limit=50&offset=50&category=Weather": { data: [ev("Weather", 3, "0.10", "0.30")], pagination: { total: 51 } },
      "/v1/prediction-markets/events?status=active&limit=50&offset=0&category=Economics": { data: [ev("Economics", 1, "0.05", "0.06")], pagination: { total: 1 } },
    };
    const calls: string[] = [];
    const fetchJson = async (path: string) => {
      calls.push(path);
      if (path.startsWith("/v1/book/")) return { bids: [{ price: "0.47", amount: "100" }], asks: [{ price: "0.50", amount: "100" }] };
      return pages[path] ?? null;
    };
    // Seed a stale contract that the sweep will no longer list.
    await db.query(
      "INSERT INTO market_catalog (symbol, category, close_ms, seen_at, listed) VALUES ('GEMI-OLD', 'Weather', $1, $2, '{}'::jsonb)",
      [NOW + H, NOW - 2 * H],
    );

    const first = await refreshStep(db, fetchJson, { now: NOW, listBudget: 2, bookBudget: 0 });
    expect(first).toMatchObject({ pages: 2, swept: false });
    const second = await refreshStep(db, fetchJson, { now: NOW, listBudget: 2, bookBudget: 5 });
    expect(second).toMatchObject({ pages: 1, swept: true });
    // Books only for the two contracts whose listed spread can pass (Weather1 3¢, Economics1 1¢).
    expect(calls.filter((c) => c.startsWith("/v1/book/")).sort()).toEqual([
      "/v1/book/GEMI-Economics1-Y?limit_bids=0&limit_asks=0",
      "/v1/book/GEMI-Weather1-Y?limit_bids=0&limit_asks=0",
    ]);
    const rows = await allRows(db, NOW);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["GEMI-Economics1-Y", "GEMI-Weather1-Y", "GEMI-Weather2-Y", "GEMI-Weather3-Y"]);
    const items = rows.map((r) => ({ row: r, q: classify(r, NOW) }));
    const s = summarize(items);
    expect(s.find((x) => x.category === "Weather")).toMatchObject({ events: 3, contracts: 3, works: 1 });

    // Partial reads, filtered in SQL (pages never read the whole table).
    const sym = (rs: CatalogRow[]) => rs.map((r) => r.symbol).sort();
    expect(sym(await queryRows(db, NOW, { usable: true }, 100))).toEqual(["GEMI-Economics1-Y", "GEMI-Weather1-Y"]);
    expect(sym(await queryRows(db, NOW, { category: "Weather" }, 100))).toEqual(["GEMI-Weather1-Y", "GEMI-Weather2-Y", "GEMI-Weather3-Y"]);
    expect(sym(await queryRows(db, NOW, { q: "weather 3" }, 100))).toEqual(["GEMI-Weather3-Y"]);
    expect(sym(await queryRows(db, NOW, { q: "50%_" }, 100))).toEqual([]);
    expect(sym(await queryRows(db, NOW, { even: true }, 100))).toEqual(["GEMI-Economics1-Y", "GEMI-Weather1-Y"]);
    expect(sym(await queryRows(db, NOW, { withinH: 1 }, 100))).toEqual([]);
    // fresh books first, then the tighter spread
    expect((await queryRows(db, NOW, {}, 2)).every((r) => r.book !== null)).toBe(true);
    expect(await countRows(db, NOW, { category: "Weather" })).toBe(3);
    // a book older than 15 minutes no longer counts as usable
    expect(await queryRows(db, NOW + 16 * 60_000, { usable: true }, 100)).toEqual([]);
    const counts = await categoryCounts(db, NOW);
    expect(counts.find((c) => c.category === "Weather")).toMatchObject({ contracts: 3, events: 3 });
  });
});
