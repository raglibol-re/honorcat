import { getAddress, type Address, type Hex, type LocalAccount } from "viem";
import { bookStats } from "./catalog";
import { fetchMarketState, readBook, type MarketState } from "./gemini";
import { evaluate, classify, type Sample } from "./trigger/engine";
import { buildRecord, evidenceHash, recordToJson } from "./trigger/evidence";
import type { TriggerParams } from "./trigger/params";
import type { BookSource } from "./sampler";
import { KIND, P, averageTyped, depthDigest, marketGate, outcomeDigest, windowDigest, wouldCosign, type CosignTask, type DepthAtt, type LevelWatch, type MeasureTask, type OutcomeAtt, type WindowAtt } from "./pots";

/**
 * A pot sampler: one of the three independent signers for two-sided pots. It reads Gemini's public
 * order book itself, keeps its own samples per market, and for every window the relay asks about it
 *   1. builds its own evidence record for exactly that window and signs the record hash (its average);
 *   2. later co-signs the relay's proposal only if it is within 0.5 points of its own average;
 *   3. watches the nets and bowls of live pots and asks for a window when a level held.
 * It signs depth (the cap) only if its own reading is at least 80% of the proposed figure, and an
 * outcome only if Gemini's own settlement says the same.
 */
export type PotsWork = { now: number; measure: MeasureTask[]; cosign: CosignTask[]; levels: LevelWatch[]; pots: Address; chainId: number; median?: Address | null };
export type SignedAverage = { priceYes: number; valid: boolean; sampleCount: number; signature: Hex };

export type PotsIo = {
  work(signer: Address): Promise<PotsWork>;
  average(requestId: string, body: { signer: Address; record: unknown; signature: Hex; average?: SignedAverage }): Promise<unknown>;
  cosign(requestId: string, body: { signer: Address; signature: Hex }): Promise<unknown>;
  level(body: { potId: string; side: 0 | 1; kind: number; windowEnd: number }): Promise<unknown>;
};

type Book = { samples: Sample[]; params: TriggerParams; nextAt: number };

export const DEPTH_TOLERANCE = 0.8;

export class PotSampler {
  readonly address: Address;
  private books = new Map<string, Book>();
  private own = new Map<string, { ppm: bigint; valid: boolean }>();
  private done = new Set<string>();
  private levelAsked = new Map<string, number>();
  private work: PotsWork | null = null;
  private workAt = 0;
  marketState: (e: string, c: string) => Promise<MarketState | null> = fetchMarketState;
  depthOf: (instrument: string) => Promise<number | null> = async (i) => {
    const raw = await readBook(i);
    if (!raw) return null;
    const s = bookStats(raw, Date.now());
    return s.bid === null || s.ask === null ? 0 : Math.floor(Math.min(s.bidDepth, s.askDepth) * 100);
  };

  constructor(
    private account: LocalAccount,
    private source: BookSource,
    private io: PotsIo,
    private log: (m: string) => void = () => {},
    private store?: { load(instrument: string): Promise<Sample[]>; save(instrument: string, s: Sample[]): Promise<void> },
  ) {
    this.address = getAddress(account.address);
  }

  /** Markets currently sampled (pending windows and watched levels). */
  get watching() {
    return this.books.size;
  }

  get busy() {
    return !!this.work && (this.work.measure.length > 0 || this.work.cosign.length > 0 || this.work.levels.length > 0);
  }

  /** Only windows to measure or proposals to co-sign (what a short-lived host must stay up for). */
  get busyWithWindows() {
    return !!this.work && (this.work.measure.length > 0 || this.work.cosign.length > 0);
  }

  private async refresh(now: number) {
    if (this.work && now - this.workAt < 3_000) return;
    this.workAt = now;
    this.work = await this.io.work(this.address);
    const want = new Map<string, TriggerParams>();
    for (const m of this.work.measure) want.set(m.instrument, m.params);
    for (const l of this.work.levels) want.set(l.instrument, l.params);
    for (const k of [...this.books.keys()]) if (!want.has(k)) this.books.delete(k);
    for (const [instrument, params] of want) {
      if (this.books.has(instrument)) continue;
      const samples = this.store ? await this.store.load(instrument) : [];
      this.books.set(instrument, { samples, params, nextAt: 0 });
    }
    this.source.watch([...want.keys()]);
  }

  private async sample(now: number) {
    for (const [instrument, b] of this.books) {
      if (now < b.nextAt) continue;
      b.nextAt = Math.max(now, (b.nextAt || now) + b.params.intervalMs);
      const top = await this.source.snapshot(instrument);
      const s = classify({ t: now, dataT: top?.recv ?? 0, bid: top?.bid ?? null, bidSize: top?.bidSize ?? null, ask: top?.ask ?? null, askSize: top?.askSize ?? null }, b.params);
      const last = b.samples.at(-1);
      if (!last || s.t > last.t) b.samples.push(s);
      const keepFrom = now - 15 * 60_000;
      if (b.samples[0] && b.samples[0].t < keepFrom) b.samples = b.samples.filter((x) => x.t >= keepFrom);
      if (this.store) await this.store.save(instrument, b.samples);
    }
  }

  /** Own average for a window, from this sampler's own samples. */
  private measureWindow(w: PotsWork, m: MeasureTask) {
    const b = this.books.get(m.instrument);
    const samples = (b?.samples ?? []).filter((x) => x.t > m.windowStart * 1000 && x.t <= m.windowEnd * 1000);
    return buildRecord({
      chainId: w.chainId,
      vault: w.pots,
      potId: BigInt(m.potId),
      instrument: m.instrument,
      side: "yes",
      mode: "early-only",
      params: m.params,
      samples,
      windowEnd: m.windowEnd * 1000,
      dataSource: this.source.name,
      signer: this.address,
    });
  }

  async step(now = Date.now()) {
    await this.refresh(now);
    await this.sample(now);
    const w = this.work!;

    // 1. Windows that have ended: post this sampler's own signed average.
    for (const m of w.measure) {
      if (this.done.has(`avg:${m.requestId}`) || now < m.windowEnd * 1000 + 1_500) continue;
      const { record, decision } = this.measureWindow(w, m);
      const hash = evidenceHash(record);
      const signature = await this.account.signMessage({ message: { raw: hash } });
      const ppm = record.averageMicro / 10n ** BigInt(record.params.priceDecimals);
      // Gemini's own status counts too: no price while the market is halted, under review or closed.
      const gate = m.eventTicker ? marketGate(await this.marketState(m.eventTicker, m.contractTicker).catch(() => null)) : null;
      const valid = (decision.code === 0 || decision.code === 1) && gate === null;
      this.own.set(m.requestId, { ppm, valid });
      // Pots on the MedianResolver: sign this average itself; the contract computes the price from them.
      let average: SignedAverage | undefined;
      if (w.median && m.resolver && m.resolver.toLowerCase() === w.median.toLowerCase()) {
        const v = { priceYes: Number(ppm), valid, sampleCount: record.validCount, evidenceHash: hash };
        const typed = averageTyped(w.median, { potId: m.potId, kind: m.kind, nonce: m.nonce, windowStart: m.windowStart, windowEnd: m.windowEnd }, v, { chainId: w.chainId, pots: w.pots });
        average = { priceYes: v.priceYes, valid, sampleCount: v.sampleCount, signature: await this.account.signTypedData(typed) };
      }
      if (gate) this.log(`pot ${m.potId}: ${gate}; this sampler gives no price`);
      try {
        await this.io.average(m.requestId, { signer: this.address, record: recordToJson(record), signature, average });
        this.log(`pot ${m.potId}: window ${m.windowStart}-${m.windowEnd} average ${(Number(ppm) / 10_000).toFixed(2)}% (${decision.validCount} valid samples${valid ? "" : ", not valid"})`);
      } catch (err) {
        this.log(`pot ${m.potId}: average not accepted: ${(err as Error).message.slice(0, 160)}`);
      }
      this.done.add(`avg:${m.requestId}`);
    }

    // 2. Proposals: co-sign only what this sampler's own data supports.
    for (const c of w.cosign) {
      if (this.done.has(`sig:${c.requestId}`)) continue;
      this.done.add(`sig:${c.requestId}`);
      const at = { chainId: w.chainId, pots: w.pots };
      let ok = false;
      let why = "";
      if (c.kind === "window") {
        const a = c.payload.attestation as WindowAtt;
        if (w.median && String(c.payload.resolver ?? "").toLowerCase() === w.median.toLowerCase()) why = "pots on the MedianResolver get signed averages, never co-signed prices";
        else if (windowDigest(a, at) !== c.digest) why = "digest does not match the proposal";
        else {
          // A short-lived host (the app) may have lost its memory: its own signed average is in the payload.
          const mineRow = (c.payload.averages as { signer: string; ppm: string; valid: boolean }[] | undefined)?.find((x) => getAddress(x.signer) === this.address);
          const own = this.own.get(c.requestId) ?? (mineRow ? { ppm: BigInt(mineRow.ppm), valid: mineRow.valid } : null);
          ok = wouldCosign(own, a);
          why = ok ? `${a.valid ? (a.priceYes / 10_000).toFixed(2) + "%" : "no price"} agrees with own data` : "proposal is more than 0.5 points from own average (or no own average)";
        }
      } else if (c.kind === "depth") {
        const d = c.payload.attestation as DepthAtt;
        const instrument = String(c.payload.instrument ?? "");
        const mine = instrument ? await this.depthOf(instrument) : null;
        if (depthDigest(d, at) !== c.digest) why = "digest does not match";
        else if (mine === null) why = "could not read the book";
        else {
          ok = mine >= Number(d.contracts5c) * DEPTH_TOLERANCE;
          why = `own depth ${mine / 100} vs proposed ${Number(d.contracts5c) / 100} contracts`;
        }
      } else if (c.kind === "outcome") {
        const o = c.payload.attestation as OutcomeAtt;
        const st = await this.marketState(String(c.payload.eventTicker), String(c.payload.contractTicker));
        const seen = st?.resolutionSide === "yes" ? 1 : st?.resolutionSide === "no" ? 0 : st?.status === "invalid" ? 2 : null;
        if (outcomeDigest(o, at) !== c.digest) why = "digest does not match";
        else {
          ok = seen === o.outcome;
          why = `Gemini shows ${seen === null ? "no result" : ["NO", "YES", "void"][seen]}`;
        }
      }
      if (!ok) {
        this.log(`request ${c.requestId}: not co-signed (${why})`);
        continue;
      }
      const signature = await this.account.sign!({ hash: c.digest });
      try {
        await this.io.cosign(c.requestId, { signer: this.address, signature });
        this.log(`request ${c.requestId}: co-signed (${why})`);
      } catch (err) {
        this.log(`request ${c.requestId}: co-signature not accepted: ${(err as Error).message.slice(0, 160)}`);
      }
    }

    // 3. Nets and bowls: a side's own price held at or beyond its level for a full window.
    const nowS = Math.floor(now / 1000);
    for (const l of w.levels) {
      if (nowS - l.window <= l.setAt) continue; // the window must start after the level was set
      const key = `${l.potId}:${l.side}:${l.nonce}`;
      if (now - (this.levelAsked.get(key) ?? 0) < 60_000) continue;
      const b = this.books.get(l.instrument);
      if (!b) continue;
      const end = nowS * 1000;
      const inWin = b.samples.filter((x) => x.t > end - l.window * 1000 && x.t <= end);
      const d = evaluate(inWin, l.params, "yes", end);
      if (d.code !== 0 && d.code !== 1) continue;
      const ppm = d.averageMicro / 10n ** BigInt(l.params.priceDecimals);
      const own = l.side === 0 ? ppm : P - ppm;
      const hit = l.net > 0 && own <= BigInt(l.net) ? KIND.netYes + l.side : l.bowl > 0 && own >= BigInt(l.bowl) ? KIND.bowlYes + l.side : null;
      if (hit === null) continue;
      this.levelAsked.set(key, now);
      try {
        await this.io.level({ potId: l.potId, side: l.side, kind: hit, windowEnd: nowS });
        this.log(`pot ${l.potId}: ${hit < KIND.bowlYes ? "net" : "bowl"} of ${l.side === 0 ? "YES" : "NO"} held (own price ${(Number(own) / 10_000).toFixed(2)}%); window requested`);
      } catch (err) {
        this.log(`pot ${l.potId}: level request failed: ${(err as Error).message.slice(0, 160)}`);
      }
    }
  }
}

/** HTTP adapter for samplers outside the app (local machine, GitHub Actions). */
export function potsHttpIo(api: string): PotsIo {
  const base = api.replace(/\/$/, "");
  const req = async (path: string, init?: RequestInit) => {
    const r = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 200)}`);
    return JSON.parse(text) as unknown;
  };
  const enc = encodeURIComponent;
  return {
    work: async (signer) => {
      const j = (await req(`/api/hc/sampler/work?signer=${signer}`)) as PotsWork;
      return j;
    },
    average: (id, body) => req(`/api/hc/sampler/average?id=${enc(id)}`, { method: "POST", body: JSON.stringify(body) }),
    cosign: (id, body) => req(`/api/hc/sampler/cosign?id=${enc(id)}`, { method: "POST", body: JSON.stringify(body) }),
    level: (body) => req(`/api/hc/sampler/level`, { method: "POST", body: JSON.stringify(body) }),
  };
}
