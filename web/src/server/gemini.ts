import "server-only";

/**
 * Gemini prediction-market reads for Verdict Guarantees. Field meanings verified against
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
};

export async function listActiveEvents(category: string, limit = 100): Promise<GeminiEvent[]> {
  const url = `${BASE}/v1/prediction-markets/events?status=active&limit=${limit}&category=${encodeURIComponent(category)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  return ((await res.json()) as { data: GeminiEvent[] }).data;
}

export async function getEvent(ticker: string): Promise<GeminiEvent | null> {
  const res = await fetch(`${BASE}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  return (await res.json()) as GeminiEvent;
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
