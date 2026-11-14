import "server-only";
import { getEvent, impliedChance, listActiveEvents, type GeminiContract, type GeminiEvent } from "./gemini";

/**
 * Verdict Guarantees templates. Each one maps to live Gemini events read from the public API;
 * nothing is hardcoded. Contract terms are rendered from the API fields `title`, `label`,
 * `strike` and `expiryDate` (field meanings verified against developer.gemini.com).
 */
export type Template = "rate" | "temperature" | "price" | "demo";

export const TEMPLATE_INFO: Record<Template, { title: string; blurb: string; categories: string[] }> = {
  rate: { title: "Rate guarantee", blurb: "Refund if the Fed decides a certain way at its next meeting.", categories: ["Economics"] },
  temperature: { title: "Temperature guarantee", blurb: "Refund if a city's daily high crosses a threshold.", categories: ["Weather"] },
  price: { title: "Price guarantee", blurb: "Refund if a crypto or commodity price ends above or below a level.", categories: ["Crypto", "Commodities"] },
  demo: { title: "Demo (5-minute market)", blurb: "Settles within minutes. For trying the flow end to end; clearly a demo.", categories: ["Crypto"] },
};

const isShortCrypto = (e: GeminiEvent) => /\d(05M|15M)\d/.test(e.ticker) || /^[A-Z]+(05M|15M)\d{10}$/.test(e.ticker);

function belongs(t: Template, e: GeminiEvent): boolean {
  switch (t) {
    case "rate":
      return /^FED\d/.test(e.ticker);
    case "temperature":
      return /^WXHIGH-/.test(e.ticker);
    case "price":
      return !isShortCrypto(e) && e.contracts.some((c) => c.strike?.type === "above" || c.strike?.type === "below");
    case "demo":
      return isShortCrypto(e);
  }
}

/** Earliest acceptable expiry: enough time to enrol customers before the lock. */
const MIN_LEAD_SECONDS: Record<Template, number> = { rate: 3600, temperature: 3600, price: 1800, demo: 150 };

export type MarketContract = {
  ticker: string;
  label: string;
  status: string;
  marketState: string | null;
  chanceYes: number | null; // estimate from the market price
  askYes: number | null; // price to buy one YES contract (USD)
  askNo: number | null;
  strike: { type: string; value: string | null } | null;
};
export type Market = {
  ticker: string;
  title: string;
  category: string;
  expiry: string;
  contracts: MarketContract[];
};

const n = (v?: string | null) => (v === undefined || v === null || v === "" ? null : Number(v));

function toContract(c: GeminiContract): MarketContract {
  return {
    ticker: c.ticker,
    label: c.label,
    status: c.status,
    marketState: c.marketState ?? null,
    chanceYes: impliedChance(c.prices),
    askYes: n(c.prices?.bestAsk) ?? n(c.prices?.buy?.yes),
    askNo: n(c.prices?.buy?.no),
    strike: c.strike ? { type: c.strike.type, value: c.strike.value } : null,
  };
}

export function toMarket(e: GeminiEvent): Market {
  return {
    ticker: e.ticker,
    title: e.title,
    category: e.category,
    expiry: e.expiryDate ?? "",
    contracts: e.contracts.filter((c) => c.status === "active").map(toContract),
  };
}

export async function marketsFor(t: Template): Promise<Market[]> {
  const now = Date.now();
  const all = (await Promise.all(TEMPLATE_INFO[t].categories.map((c) => listActiveEvents(c, 200).catch(() => [])))).flat();
  return all
    .filter((e) => belongs(t, e) && e.status === "active" && e.expiryDate && new Date(e.expiryDate).getTime() > now + MIN_LEAD_SECONDS[t] * 1000)
    .sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""))
    .slice(0, t === "temperature" ? 60 : 30)
    .map(toMarket)
    .filter((m) => m.contracts.length > 0);
}

export async function marketByTicker(ticker: string): Promise<GeminiEvent | null> {
  return getEvent(ticker);
}

// ------------------------------------------------------------------ plain-language terms

/**
 * "Highest temperature in Denver on November 15, 2026?" -> "highest temperature in Denver on …".
 * Only common leading words are lower-cased so names and tickers ("Fed", "BTC") stay intact.
 */
const clause = (title: string) => {
  const t = title.trim().replace(/\?$/, "");
  return /^(Highest|Lowest|Daily|Average|Oil|Gold|Silver|Copper|Natural)\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
};

/** Negates a YES-side label: "X or above" → "below X", "A to B" → "outside A to B". */
export function negateLabel(label: string): string {
  let m = /^(.*) or above$/i.exec(label);
  if (m) return `below ${m[1]}`;
  m = /^(.*) or below$/i.exec(label);
  if (m) return `above ${m[1]}`;
  m = /^(.*) to (.*)$/i.exec(label);
  if (m) return `outside ${m[1]} to ${m[2]}`;
  return `anything other than “${label}”`;
}

const money = (v: string) => {
  const x = Number(v);
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: x < 10 ? 4 : 2 })}`;
};

/**
 * The promise in one sentence. `side` says which settlement triggers refunds:
 * "yes" = the contract's own proposition, "no" = its opposite.
 */
export function promiseFor(t: Template, e: GeminiEvent, c: GeminiContract, side: "yes" | "no", merchant: string, refund: string): string {
  const pay = `${merchant} refunds your ${refund} USDC.`;
  if (t === "demo") {
    // e.g. "SOL price today at 4:05pm EST" with contract "Up" and a reference strike
    const asset = e.title.split(" ")[0];
    const when = /at (.+)$/.exec(e.title)?.[1] ?? "the end of the window";
    const level = c.strike?.value ? money(c.strike.value) : "its price at the start of the window";
    return `If ${asset} is ${side === "yes" ? "at or above" : "below"} ${level} at ${when}, ${pay}`;
  }
  if (t === "rate") {
    return `If the ${clause(e.title)} is ${side === "yes" ? `“${c.label}”` : negateLabel(c.label)}, ${pay}`;
  }
  return `If ${clause(e.title).replace(/^(?!the )/, "the ")} is ${side === "yes" ? c.label : negateLabel(c.label)}, ${pay}`;
}

/** Default enrolment lock and pot deadline (seconds) for a market expiry. */
export function defaultTimes(t: Template, expiry: number) {
  const now = Math.floor(Date.now() / 1000);
  const lockBefore: Record<Template, number> = { rate: 24 * 3600, temperature: 12 * 3600, price: 2 * 3600, demo: 75 };
  const settleWindow: Record<Template, number> = { rate: 3 * 86400, temperature: 3 * 86400, price: 2 * 86400, demo: 30 * 60 };
  let lock = expiry - lockBefore[t];
  if (lock < now + 60) lock = Math.min(expiry - 30, now + Math.max(60, Math.floor((expiry - now) / 2)));
  return { lockTime: lock, deadline: expiry + settleWindow[t] };
}

/**
 * Information only: what a merchant would buy to offset the refunds (one contract pays $1).
 * Never placed by Verdict.
 */
export function hedgeFor(c: MarketContract, side: "yes" | "no", totalRefundsUsd: number) {
  const price = side === "yes" ? c.askYes : c.askNo;
  return {
    outcome: side,
    contracts: Math.ceil(totalRefundsUsd),
    pricePerContract: price,
    cost: price === null ? null : Math.ceil(totalRefundsUsd) * price,
  };
}
