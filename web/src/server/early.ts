import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, type Address } from "viem";
import { getConfig, trigger, type EarlyTerms } from "@verdict/relay";
import { getEvent, impliedChance, listActiveEvents, type GeminiEvent } from "./gemini";

/**
 * Early payouts work on any active Gemini contract. Parameters follow the market's horizon:
 * markets that close within two hours use the (provisional) demo parameters, the rest the
 * standard ones. The demo picks whichever live contract best meets the trigger rules right now.
 */

const SHORT_HORIZON_S = 2 * 3600;

export type EarlyInput = {
  name: string;
  funder: Address;
  eventTicker: string;
  contractTicker: string;
  side: "yes" | "no";
  mode: "early-only" | "early-or-outcome";
  thresholdBps?: number;
  amount: string; // "1.25" USDC per recipient
  maxRecipients: number;
  joinSeconds?: number; // how long recipients can join (arming starts after)
  listed?: boolean;
};

export type EarlyTermsJson = Omit<EarlyTerms, "amount"> & { amount: string };

const units = (v: string) => {
  const [i, f = ""] = v.split(".");
  return BigInt(i!) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
};
const decimals = (inc?: string) => (inc && inc.includes(".") ? inc.split(".")[1]!.replace(/0+$/, "").length || 0 : 2);

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/** One plain sentence; the exact rule is on the terms screen. */
export function earlyPromise(name: string, label: string, title: string, side: "yes" | "no", bps: number, amount: string) {
  const what = side === "yes" ? `“${label}”` : `not “${label}”`;
  return `${name} pays you $${Number(amount).toFixed(2)} as soon as the market gives ${what} a ${pct(bps)} chance or more (${title.replace(/\?$/, "")}).`;
}

export async function earlyTermsFrom(input: EarlyInput): Promise<EarlyTermsJson> {
  const ev = await getEvent(input.eventTicker);
  const c = ev?.contracts.find((x) => x.ticker === input.contractTicker);
  if (!ev || !c) throw Object.assign(new Error("market not found on Gemini"), { status: 404 });
  if (ev.status !== "active" || c.status !== "active") throw Object.assign(new Error("this market is not active"), { status: 409 });
  const instrument = (c as { instrumentSymbol?: string }).instrumentSymbol;
  if (!instrument) throw Object.assign(new Error("Gemini did not return an instrument symbol for this contract"), { status: 502 });
  const now = Math.floor(Date.now() / 1000);
  const close = Math.floor(new Date((c.expiryDate ?? ev.expiryDate) || 0).getTime() / 1000);
  const template = close - now <= SHORT_HORIZON_S ? "demo" : "standard";
  const params = trigger.paramsFor(template, {
    priceDecimals: decimals((c as { priceIncrement?: string }).priceIncrement),
    sizeDecimals: decimals((c as { quantityIncrement?: string }).quantityIncrement),
  }, input.thresholdBps ? { thresholdBps: input.thresholdBps } : {});
  const join = input.joinSeconds ?? (template === "demo" ? 75 : Math.min(3600, Math.floor((close - now) / 4)));
  const lockTime = now + Math.max(30, join);
  if (lockTime + params.windowMs / 1000 + 10 > close) throw Object.assign(new Error("this market closes too soon for a full trigger window; pick one that closes later"), { status: 409 });
  const deadline = close + (input.mode === "early-or-outcome" ? 2 * 86400 : 3600);
  return {
    name: input.name.trim(),
    funder: getAddress(input.funder),
    eventTicker: ev.ticker,
    contractTicker: c.ticker,
    instrument,
    side: input.side,
    mode: input.mode,
    template,
    params,
    amount: units(input.amount).toString(),
    maxRecipients: input.maxRecipients,
    lockTime,
    tradingClose: close,
    deadline,
    eventTitle: ev.title,
    contractLabel: c.label,
    promise: earlyPromise(input.name.trim(), c.label, ev.title, input.side, params.thresholdBps, input.amount),
    listed: input.listed !== false,
  };
}

export const toEarlyTerms = (t: EarlyTermsJson): EarlyTerms => ({ ...t, funder: getAddress(t.funder), amount: BigInt(t.amount) });

function key() {
  const k = getConfig().adminToken ?? process.env.CRON_SECRET;
  if (!k) throw new Error("ADMIN_TOKEN is required to seal terms");
  return createHmac("sha256", k).update("honorcat-early-terms-v1").digest();
}
const canonical = (t: EarlyTermsJson) =>
  JSON.stringify([t.name, getAddress(t.funder), t.eventTicker, t.contractTicker, t.instrument, t.side, t.mode, t.template, t.params, t.amount, t.maxRecipients, t.lockTime, t.tradingClose, t.deadline, t.eventTitle, t.contractLabel, t.promise, t.listed !== false]);
export const sealEarly = (t: EarlyTermsJson) => createHmac("sha256", key()).update(canonical(t)).digest("base64url");
export function checkEarlySeal(t: EarlyTermsJson, seal: string) {
  const a = Buffer.from(sealEarly(t));
  const b = Buffer.from(seal);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ best-suited demo market

export type DemoCandidate = {
  eventTicker: string;
  contractTicker: string;
  instrument: string;
  title: string;
  label: string;
  image: string | null;
  side: "yes" | "no";
  chance: number; // for that side
  spread: number;
  bidSize: number;
  askSize: number;
  closesAt: string;
  meetsRules: boolean;
};

const CATEGORIES = ["Crypto", "Weather", "Economics", "Commodities", "Sports", "Politics", "Culture"];

async function topOfBook(sym: string) {
  try {
    const r = await fetch(`https://api.gemini.com/v1/book/${encodeURIComponent(sym)}?limit_bids=1&limit_asks=1`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { bids?: { price: string; amount: string }[]; asks?: { price: string; amount: string }[] };
    const b = j.bids?.[0];
    const a = j.asks?.[0];
    return b && a ? { bid: Number(b.price), ask: Number(a.price), bidSize: Number(b.amount), askSize: Number(a.amount) } : null;
  } catch {
    return null;
  }
}

/**
 * Ranks live contracts for a demo that should trigger: the order book meets the demo rules now
 * (spread, size) and one side is already above the threshold, closing far enough out for joining
 * plus one window. Also returns the soonest-closing contract that will clearly NOT cross (for a
 * demo of the refund at trading close). Reads only public Gemini data.
 */
export async function demoCandidates(thresholdBps = 8500): Promise<{ trigger: DemoCandidate[]; refund: DemoCandidate[] }> {
  const p = trigger.paramsFor("demo");
  const thr = thresholdBps / 10_000;
  const now = Date.now();
  const minClose = now + (75 + p.windowMs / 1000 + 60) * 1000;
  const events = (await Promise.all(CATEGORIES.map((c) => listActiveEvents(c, 100).catch(() => [] as GeminiEvent[])))).flat();
  type Row = Omit<DemoCandidate, "spread" | "bidSize" | "askSize" | "meetsRules"> & { estSpread: number };
  const rows: Row[] = [];
  for (const e of events) {
    for (const c of e.contracts) {
      const sym = (c as { instrumentSymbol?: string }).instrumentSymbol;
      const close = new Date((c.expiryDate ?? e.expiryDate) || 0).getTime();
      if (!sym || c.status !== "active" || close < minClose) continue;
      const yes = impliedChance(c.prices);
      const bid = Number(c.prices?.bestBid ?? NaN);
      const ask = Number(c.prices?.bestAsk ?? NaN);
      if (yes === null || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
      const side = yes >= 0.5 ? "yes" : "no";
      rows.push({
        eventTicker: e.ticker,
        contractTicker: c.ticker,
        instrument: sym,
        title: e.title,
        label: c.label,
        image: (e as { imageUrl?: string | null }).imageUrl ?? null,
        side,
        chance: side === "yes" ? yes : 1 - yes,
        closesAt: new Date(close).toISOString(),
        estSpread: ask - bid,
      });
    }
  }
  const maxSpread = p.maxSpreadUnits / 10 ** p.priceDecimals;
  const minSize = p.minSizeUnits / 10 ** p.sizeDecimals;
  const check = async (r: Row): Promise<DemoCandidate> => {
    const b = await topOfBook(r.instrument);
    const spread = b ? b.ask - b.bid : r.estSpread;
    return {
      ...r,
      spread,
      bidSize: b?.bidSize ?? 0,
      askSize: b?.askSize ?? 0,
      meetsRules: !!b && spread <= maxSpread + 1e-9 && b.bidSize >= minSize && b.askSize >= minSize,
    };
  };
  // Trigger demo: already well above the threshold, tight book, closing soonest first.
  const trig = rows
    .filter((r) => r.chance >= thr + 0.03 && r.estSpread <= maxSpread + 1e-9)
    .sort((a, b) => a.closesAt.localeCompare(b.closesAt))
    .slice(0, 6);
  const trigger_ = (await Promise.all(trig.map(check))).filter((c) => c.meetsRules);
  // Refund demo: closes soonest, far below the threshold on its side.
  const ref = rows
    .map((r) => ({ ...r, side: (r.side === "yes" ? "no" : "yes") as "yes" | "no", chance: 1 - r.chance }))
    .filter((r) => r.chance <= thr - 0.3)
    .sort((a, b) => a.closesAt.localeCompare(b.closesAt))
    .slice(0, 3);
  const refund = await Promise.all(ref.map(check));
  return { trigger: trigger_, refund };
}
