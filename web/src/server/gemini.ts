import "server-only";

/**
 * Gemini prediction-market reads for HonorCat guarantees (retired). Field meanings verified against
 * developer.gemini.com (list-events, get-event, ~schemas, core-concepts):
 * - prices.bestBid / prices.bestAsk / prices.lastTradePrice / prices.buy.yes: USD decimal strings
 *   in 0..1; a winning contract pays $1.00, so the YES price approximates the market-implied
 *   probability ("current market price, not a guaranteed probability").
 * - contract.strike { type: above|below|reference|…, value }, contract.label: YES-side proposition.
 * - event/contract status: approved|active|closed|under_review|settled|invalid;
 *   contract.marketState: open|closed; resolutionSide: yes|no once settled.
 * Public endpoints, no key; limit 120 requests/minute.
 */
const BASE = process.env.GEMINI_API_BASE ?? "https://api.gemini.com";

export type GeminiPrices = {
  buy?: { yes?: string; no?: string };
  sell?: { yes?: string; no?: string };
  bestBid?: string;
  bestAsk?: string;
  lastTradePrice?: string;
};
export type GeminiContract = {
  ticker: string;
  label: string;
  abbreviatedName?: string | null;
  status: string;
  marketState?: string | null;
  prices?: GeminiPrices;
  strike?: { type: string; value: string | null } | null;
  expiryDate?: string | null;
  resolutionSide?: "yes" | "no" | null;
  termsAndConditionsUrl?: string;
  instrumentSymbol?: string;
  priceIncrement?: string;
  quantityIncrement?: string;
};
export type GeminiEvent = {
  ticker: string;
  title: string;
  type: "binary" | "categorical";
  category: string;
  subcategory?: { name?: string } | string | null;
  status: string;
  expiryDate?: string | null;
  contracts: GeminiContract[];
  /** Event artwork on assets.gemini.com (city photo, coin, team). */
  imageUrl?: string | null;
  /** Traded volume in USD, decimal string. */
  volume?: string | null;
  volume24h?: string | null;
};

type Cached = { at: number; value: unknown };
const g = globalThis as typeof globalThis & { __geminiCache?: Map<string, Cached> };
const cache = (g.__geminiCache ??= new Map());
const TTL_MS = 15_000;

/**
 * GET with a 15 s in-memory cache (keeps us far below 120 req/min across page views) and
 * retries: the public API intermittently answers with a non-JSON "upstream connect error".
 * Returns null on 404.
 */
async function getJson<T>(path: string): Promise<T | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (res.status === 404) return null;
      const text = await res.text();
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 80)}`);
      const value = JSON.parse(text) as T; // throws on "upstream connect error…"
      cache.set(path, { at: Date.now(), value });
      return value;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  // Serve a stale value rather than nothing if we have one.
  if (hit) return hit.value as T;
  throw lastErr;
}

export async function listActiveEvents(category: string, limit = 100): Promise<GeminiEvent[]> {
  const r = await getJson<{ data: GeminiEvent[] }>(
    `/v1/prediction-markets/events?status=active&limit=${limit}&category=${encodeURIComponent(category)}`,
  );
  return r?.data ?? [];
}

export async function getEvent(ticker: string): Promise<GeminiEvent | null> {
  return getJson<GeminiEvent>(`/v1/prediction-markets/events/${encodeURIComponent(ticker)}`);
}

const num = (v?: string | null) => (v === undefined || v === null || v === "" ? null : Number(v));

/**
 * Market-implied chance that the contract settles YES, as an estimate:
 * bid/ask midpoint if both sides are quoted, else last trade, else the ask alone; null if none.
 */
export function impliedChance(p?: GeminiPrices): number | null {
  if (!p) return null;
  const bid = num(p.bestBid);
  const ask = num(p.bestAsk);
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  const last = num(p.lastTradePrice);
  if (last !== null) return last;
  if (ask !== null) return ask;
  return num(p.buy?.yes);
}

/** "Highest temperature in Denver on November 15, 2026?" -> "the highest temperature in Denver on November 15, 2026" */
export function questionToClause(title: string): string {
  const t = title.trim().replace(/\?$/, "");
  return t.charAt(0).toLowerCase() + t.slice(1);
}
