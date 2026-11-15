import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, type Address } from "viem";
import { catalog, getConfig, getDb, getState, trigger, type Db, type EarlyTerms } from "@verdict/relay";
import { liveQuality } from "./catalog";
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
  /** "demo" forces the demo parameters (the demo template); otherwise they follow the horizon. */
  template?: "demo" | "standard";
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
  return `${name} pays you $${Number(amount).toFixed(2)} as soon as the market puts the chance of ${what} at ${pct(bps)} or more (${title.replace(/\?$/, "")}).`;
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
  const template = input.template ?? (close - now <= SHORT_HORIZON_S ? "demo" : "standard");
  // Refuse a market whose order book fails this pot's own rule right now, and say why: such a pot
  // could never pay early. The stored catalogue may be minutes old, so read the book live.
  const fallback = catalog.rowsFromEvent(ev as unknown as catalog.ListedEvent, Date.now()).find((r) => r.symbol === instrument);
  const live = await liveQuality(await getDb(), instrument, fallback ? { ...fallback, book: null } : null, template);
  if (!live.book) throw Object.assign(new Error("Gemini did not return this market's order book; try again in a moment"), { status: 502 });
  if (live.quality?.status === "unavailable")
    throw Object.assign(new Error(`This market does not meet the ${template} rule right now: ${live.quality.reasons.join("; ")}.`), { status: 409, reasons: live.quality.reasons });
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
  category: string;
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

type Snap = { bid: number; ask: number; bidSize: number; askSize: number };

/** Collects Gemini `{symbol}@depth5` snapshots (one per second per symbol) for `ms` milliseconds. */
async function observeBooks(symbols: string[], ms: number): Promise<Map<string, Snap[]>> {
  const out = new Map<string, Snap[]>(symbols.map((s) => [s.toLowerCase(), []]));
  if (!symbols.length) return out;
  await new Promise<void>((resolve) => {
    const ws = new WebSocket("wss://ws.gemini.com");
    const done = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve();
    };
    const timer = setTimeout(done, ms);
    ws.onopen = () => ws.send(JSON.stringify({ id: "1", method: "SUBSCRIBE", params: symbols.map((s) => `${s}@depth5`) }));
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(String(m.data)) as { symbol?: string; bids?: [string, string][]; asks?: [string, string][] };
        const list = j.symbol ? out.get(j.symbol.toLowerCase()) : undefined;
        if (!list) return;
        const b = j.bids?.[0];
        const a = j.asks?.[0];
        list.push({ bid: Number(b?.[0] ?? 0), bidSize: Number(b?.[1] ?? 0), ask: Number(a?.[0] ?? 0), askSize: Number(a?.[1] ?? 0) });
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      done();
    };
  });
  return out;
}

/**
 * Ranks live contracts for a demo that should trigger: the order book meets the demo rules now
 * (spread, size) and one side is already above the threshold, closing far enough out for joining
 * plus one window. Also returns the soonest-closing contract that will clearly NOT cross (for a
 * demo of the refund at trading close). Reads only public Gemini data.
 */
export type DemoCandidates = { trigger: DemoCandidate[]; watch: DemoCandidate[]; refund: DemoCandidate[] };

export async function demoCandidates(thresholdBps = 8500): Promise<DemoCandidates> {
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
        category: e.category,
        side,
        chance: side === "yes" ? yes : 1 - yes,
        closesAt: new Date(close).toISOString(),
        estSpread: ask - bid,
      });
    }
  }
  const maxSpread = p.maxSpreadUnits / 10 ** p.priceDecimals;
  const minSize = p.minSizeUnits / 10 ** p.sizeDecimals;
  // A thin book can flip to one-sided between snapshots: require several consecutive snapshots,
  // ~1.5 s apart, to all meet the rules, and report the weakest one.
  const check = async (r: Row, snapshots = 4): Promise<DemoCandidate> => {
    let worst: { spread: number; bidSize: number; askSize: number } | null = null;
    let ok = true;
    for (let i = 0; i < snapshots; i++) {
      if (i) await new Promise((res) => setTimeout(res, 1500));
      const b = await topOfBook(r.instrument);
      const good = !!b && b.ask - b.bid <= maxSpread + 1e-9 && b.bidSize >= minSize && b.askSize >= minSize;
      ok &&= good;
      if (!b) {
        worst = { spread: 1, bidSize: 0, askSize: 0 };
        break;
      }
      worst = worst
        ? { spread: Math.max(worst.spread, b.ask - b.bid), bidSize: Math.min(worst.bidSize, b.bidSize), askSize: Math.min(worst.askSize, b.askSize) }
        : { spread: b.ask - b.bid, bidSize: b.bidSize, askSize: b.askSize };
      if (!good) break;
    }
    return { ...r, spread: worst?.spread ?? r.estSpread, bidSize: worst?.bidSize ?? 0, askSize: worst?.askSize ?? 0, meetsRules: ok };
  };
  // Trigger demo: already well above the threshold with a tight book. Watch each candidate's book
  // over Gemini's WebSocket for ~12 s (one snapshot per second, no REST rate limit) and keep only
  // books where nearly every snapshot passes the demo rules: a sampler needs 25 valid of 30.
  const trig = rows
    .filter((r) => r.chance >= thr + 0.03 && r.estSpread <= maxSpread + 1e-9)
    .sort((a, b) => a.closesAt.localeCompare(b.closesAt))
    .slice(0, 12);
  // Watch demo: a healthy book a little below the threshold, so people can watch it cross (or not).
  const near = rows
    .flatMap((r) => [r, { ...r, side: (r.side === "yes" ? "no" : "yes") as "yes" | "no", chance: 1 - r.chance }])
    .filter((r) => r.chance >= thr - 0.08 && r.chance < thr - 0.005 && r.estSpread <= maxSpread + 1e-9)
    .sort((a, b) => b.chance - a.chance)
    .slice(0, 10);
  const seen = await observeBooks([...new Set([...trig, ...near].map((r) => r.instrument))], 12_000);
  const observe = (r: Row): DemoCandidate & { validRate: number; observedChance: number | null } => {
      const snaps = seen.get(r.instrument.toLowerCase()) ?? [];
      const good = snaps.filter((b) => b.bid > 0 && b.ask > 0 && b.ask - b.bid <= maxSpread + 1e-9 && b.bidSize >= minSize && b.askSize >= minSize);
      const mids = good.map((b) => (r.side === "yes" ? (b.bid + b.ask) / 2 : 1 - (b.bid + b.ask) / 2));
      const worst = snaps.reduce((w, b) => ({ spread: Math.max(w.spread, b.ask - b.bid), bidSize: Math.min(w.bidSize, b.bidSize), askSize: Math.min(w.askSize, b.askSize) }), { spread: 0, bidSize: Infinity, askSize: Infinity });
      const validRate = snaps.length >= 8 ? good.length / snaps.length : 0;
      const observedChance = mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : null;
      return {
        ...r,
        spread: snaps.length ? worst.spread : r.estSpread,
        bidSize: Number.isFinite(worst.bidSize) ? worst.bidSize : 0,
        askSize: Number.isFinite(worst.askSize) ? worst.askSize : 0,
        validRate,
        observedChance,
        meetsRules: validRate >= 0.9 && observedChance !== null,
      };
    };
  const trigger_ = trig
    .map(observe)
    .filter((c) => c.meetsRules && c.observedChance !== null && c.observedChance >= thr + 0.02)
    .sort((a, b) => b.validRate - a.validRate || Math.min(b.bidSize, b.askSize) - Math.min(a.bidSize, a.askSize) || a.closesAt.localeCompare(b.closesAt));
  // Refund demo: closes soonest, far below the threshold on its side.
  const ref = rows
    .map((r) => ({ ...r, side: (r.side === "yes" ? "no" : "yes") as "yes" | "no", chance: 1 - r.chance }))
    .filter((r) => r.chance <= thr - 0.3 && new Date(r.closesAt).getTime() <= now + 45 * 60_000)
    // Far below the threshold first (a coin-flip market could still cross), then soonest close.
    .sort((a, b) => Number(b.chance <= 0.15) - Number(a.chance <= 0.15) || a.closesAt.localeCompare(b.closesAt))
    .slice(0, 12);
  // Pots are refused at creation when the book fails the rule: keep only candidates that pass now.
  const refund = (await Promise.all(ref.map((r) => check(r, 1)))).filter((c) => c.meetsRules);
  const watch = near
    .map(observe)
    .filter((c) => c.meetsRules && c.observedChance !== null && c.observedChance < thr && c.observedChance >= thr - 0.08)
    .map((c) => ({ ...c, chance: c.observedChance ?? c.chance }))
    .sort((a, b) => b.chance - a.chance);
  return { trigger: trigger_, watch, refund };
}

// Precomputed candidates: finding one watches order books for ~12 s, so the Streams webhook keeps a
// fresh result in relay_state and the demo button reads it at once.
const DEMO_KEY = "demo_candidates";
const DEMO_LEASE = "demo_candidates_lease";
export const DEMO_REFRESH_MS = 90_000;
export const DEMO_MAX_AGE_MS = 5 * 60_000;

export async function cachedDemo(db: Db): Promise<(DemoCandidates & { at: number }) | null> {
  const v = await getState(db, DEMO_KEY);
  if (!v) return null;
  try {
    return JSON.parse(v) as DemoCandidates & { at: number };
  } catch {
    return null;
  }
}

/** Recomputes the candidates when the cached ones are older than DEMO_REFRESH_MS; one refresh at a time. */
export async function refreshDemo(db: Db, opts: { force?: boolean } = {}): Promise<(DemoCandidates & { at: number }) | null> {
  const now = Date.now();
  if (!opts.force) {
    const c = await cachedDemo(db);
    if (c && now - c.at < DEMO_REFRESH_MS) return c;
  }
  const lease = await db.query(
    `INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
     WHERE relay_state.value::bigint < $3 RETURNING key`,
    [DEMO_LEASE, String(now), String(now - 60_000)],
  );
  if (!lease.length) return cachedDemo(db);
  const fresh = { ...(await demoCandidates()), at: Date.now() };
  // Keep the last good result when Gemini returns nothing usable for a moment.
  const prev = await cachedDemo(db);
  const merged = fresh.trigger.length || fresh.watch.length || !prev || Date.now() - prev.at > DEMO_MAX_AGE_MS ? fresh : { ...prev };
  await db.query(
    "INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [DEMO_KEY, JSON.stringify(merged)],
  );
  await db.query("UPDATE relay_state SET value = '0' WHERE key = $1", [DEMO_LEASE]);
  return merged;
}
