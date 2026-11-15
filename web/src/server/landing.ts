import "server-only";
import { catalogList } from "./catalog";
import { getEvent, impliedChance } from "./gemini";
import { earlyDetail, getConfig, getDb, listEarly } from "./relay";

export type Hero = {
  source: "pot" | "market";
  potId: string | null;
  chance: number | null;
  threshold: number;
  side: "yes" | "no";
  label: string;
  title: string;
  instrument: string;
};

// Gemini allows 120 public requests a minute: one fresh price per contract every 5 s is plenty.
const priceCache = new Map<string, { at: number; yes: number | null }>();
async function liveYes(eventTicker: string, contractTicker: string): Promise<number | null> {
  const key = `${eventTicker}:${contractTicker}`;
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < 5000) return hit.yes;
  const ev = await getEvent(eventTicker).catch(() => null);
  const c = ev?.contracts.find((x) => x.ticker === contractTicker);
  const yes = c && c.status === "active" ? impliedChance(c.prices) : null;
  priceCache.set(key, { at: Date.now(), yes });
  return yes;
}

/**
 * Everything the landing page shows, all real:
 * - hero: an open or watched pot (chance from its samplers, else Gemini), otherwise the live
 *   Gemini contract the demo would use right now, with the demo threshold of 85%;
 * - payout: the latest real early payout, its recorded samples as a series (averaged per time
 *   bucket across the samplers), when it paid, and its state for the rail.
 */
export async function landingData() {
  const db = await getDb();
  const cfg = getConfig();

  let hero: Hero | null = null;
  const open = (await listEarly(db)).find((e) => e.state === "locked" || e.state === "armed");
  if (open) {
    const d = await earlyDetail(db, open.id);
    const fresh = d?.samples.find((s) => s.status === 0 && s.mid !== null && Date.now() - s.t < 30_000)?.mid ?? null;
    const yes = fresh === null ? await liveYes(open.eventTicker, open.contractTicker) : null;
    hero = {
      source: "pot",
      potId: open.id,
      chance: fresh ?? (yes === null ? null : open.side === "yes" ? yes : 1 - yes),
      threshold: open.params.thresholdBps / 10_000,
      side: open.side,
      label: open.contractLabel,
      title: open.eventTitle,
      instrument: open.instrument,
    };
  } else {
    // No open pot: the best-quoted contract that works right now, from the market catalogue.
    const best = (await catalogList(db, { usable: true, limit: 20 })).items.find((m) => m.book?.bid != null && m.book?.ask != null);
    if (best) {
      const mid = (best.book!.bid! + best.book!.ask!) / 2;
      const side = mid >= 0.5 ? "yes" : "no";
      hero = {
        source: "market",
        potId: null,
        chance: side === "yes" ? mid : 1 - mid,
        threshold: 0.85,
        side,
        label: best.label,
        title: best.eventTitle,
        instrument: best.symbol,
      };
    }
  }

  // Featured payout: prefer one whose recorded line starts below the threshold (a visible crossing,
  // as the "Watch it cross" demo makes); otherwise the latest early payout, flagged as not crossing.
  const rows = await db.query<{ id: string; crossed: boolean | null }>(
    `SELECT e.id,
       (SELECT s.mid_micro FROM early_samples s
         WHERE s.early_id = e.id AND s.status = 0 AND s.mid_micro IS NOT NULL ORDER BY s.t LIMIT 1)
         < (e.params->>'thresholdBps')::bigint * 100 AS crossed
     FROM early_pots e
     WHERE e.status = 'live' AND e.settled_kind = 'early' AND e.settled_at IS NOT NULL
       AND (SELECT count(*) FROM early_samples s WHERE s.early_id = e.id AND s.status = 0) >= 20
     ORDER BY crossed DESC NULLS LAST, e.settled_at DESC LIMIT 1`,
  );
  const d = rows[0] ? await earlyDetail(db, rows[0].id) : null;
  let payout = null;
  if (d) {
    const e = d.early;
    const valid = d.samples.filter((s) => s.status === 0 && s.mid !== null).sort((a, b) => a.t - b.t);
    const paidAt =
      d.signatures
        .filter((s) => s.kind === "trigger")
        .map((s) => Number((s.record as { windowEnd?: string } | null)?.windowEnd ?? 0))
        .sort((a, b) => a - b)[1] ?? null;
    // Average the samplers' midpoints per time bucket: one honest line, about 60 points.
    const t0 = valid[0]?.t ?? 0;
    const t1 = valid.at(-1)?.t ?? t0;
    const span = Math.max(1, t1 - t0);
    const buckets = new Map<number, { sum: number; n: number; t: number }>();
    for (const s of valid) {
      const b = Math.min(59, Math.floor(((s.t - t0) / span) * 60));
      const cur = buckets.get(b) ?? { sum: 0, n: 0, t: 0 };
      cur.sum += s.mid!;
      cur.n += 1;
      cur.t += s.t;
      buckets.set(b, cur);
    }
    const paidTo = d.payments.filter((p) => p.account && p.kind !== "LeftoverReturned");
    const series = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => ({ t: Math.round(v.t / v.n), p: v.sum / v.n }));
    payout = {
      id: e.id,
      eventTitle: e.eventTitle,
      contractLabel: e.contractLabel,
      side: e.side,
      instrument: e.instrument,
      threshold: e.params.thresholdBps / 10_000,
      intervalMs: e.params.intervalMs,
      amount: e.amount,
      recipients: d.recipients.length,
      tradingClose: e.tradingClose,
      settledAt: d.settledAt ? new Date(d.settledAt).toISOString() : null,
      paidAt,
      record: e.record,
      vault: cfg.vault,
      series,
      crossed: rows[0]?.crossed === true,
      // Every rail value comes from this payout's records.
      checks: new Set(d.samples.map((s) => s.signer)).size,
      triggerSigners: new Set(d.signatures.filter((s) => s.kind === "trigger").map((s) => s.signer.toLowerCase())).size,
      paidTotal: paidTo.reduce((a, p) => a + BigInt(p.amount), 0n).toString(),
      paidPeople: new Set(paidTo.map((p) => p.account!.toLowerCase())).size,
      paidTxs: new Set(paidTo.map((p) => p.tx)).size,
      settleSeconds: paidAt && d.settledAt ? Math.max(0, (new Date(d.settledAt).getTime() - paidAt) / 1000) : null,
      lockedTotal: (BigInt(e.amount) * BigInt(d.recipients.length)).toString(),
    };
  }

  return { hero, payout };
}

export type LandingData = Awaited<ReturnType<typeof landingData>>;
