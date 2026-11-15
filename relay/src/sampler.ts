import { getAddress, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import { verdictVaultAbi } from "./abi";
import { resolutionDomain, resolutionTypes } from "./signer";
import { buildRecord, recordToJson, signTrigger } from "./trigger/evidence";
import { classify, evaluate, type Sample } from "./trigger/engine";
import { conditionIdForTrigger } from "./trigger/params";
import type { ArmedPot, SamplerSubmission } from "./early";

/**
 * An independent sampler. It reads Gemini's public order book itself, keeps its own samples,
 * applies the trigger rule itself and signs only what its own data shows. It never trusts the app
 * for the rule: before watching a pot it recomputes the conditionId from the parameters and checks
 * it, the resolver and the pot status on-chain.
 */

export type Book = { recv: number; bid: string | null; bidSize: string | null; ask: string | null; askSize: string | null };

export interface BookSource {
  watch(instruments: string[]): void;
  snapshot(instrument: string): Promise<Book | null>;
  close(): void;
  readonly name: string;
}

const GEMINI = "https://api.gemini.com";

/** Gemini public WebSocket, `{symbol}@depth5` (a full top-5 snapshot every second). */
export class WsBookSource implements BookSource {
  readonly name = "gemini:wss://ws.gemini.com:depth5";
  private ws: WebSocket | null = null;
  private latest = new Map<string, Book>();
  private wanted = new Set<string>();
  private subscribed = new Set<string>();
  private closed = false;
  private id = 1;

  constructor(private url = "wss://ws.gemini.com") {}

  private connect() {
    if (this.closed || this.ws) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.subscribed.clear();
    ws.onopen = () => this.sync();
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(String(m.data)) as { symbol?: string; bids?: [string, string][]; asks?: [string, string][] };
        if (!j.symbol) return;
        const b = j.bids?.[0];
        const a = j.asks?.[0];
        this.latest.set(j.symbol.toLowerCase(), { recv: Date.now(), bid: b?.[0] ?? null, bidSize: b?.[1] ?? null, ask: a?.[0] ?? null, askSize: a?.[1] ?? null });
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (!this.closed) setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => ws.close();
  }

  private sync() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const add = [...this.wanted].filter((s) => !this.subscribed.has(s));
    const drop = [...this.subscribed].filter((s) => !this.wanted.has(s));
    if (add.length) ws.send(JSON.stringify({ id: String(this.id++), method: "SUBSCRIBE", params: add.map((s) => `${s}@depth5`) }));
    if (drop.length) ws.send(JSON.stringify({ id: String(this.id++), method: "UNSUBSCRIBE", params: drop.map((s) => `${s}@depth5`) }));
    add.forEach((s) => this.subscribed.add(s));
    drop.forEach((s) => {
      this.subscribed.delete(s);
      this.latest.delete(s.toLowerCase());
    });
  }

  watch(instruments: string[]) {
    this.wanted = new Set(instruments);
    if (!this.ws) this.connect();
    else this.sync();
  }

  async snapshot(instrument: string) {
    return this.latest.get(instrument.toLowerCase()) ?? null;
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

/** Gemini public REST order book, polled at sampling time (for short-lived hosts). */
export class RestBookSource implements BookSource {
  readonly name = "gemini:https://api.gemini.com/v1/book";
  watch() {}
  async snapshot(instrument: string): Promise<Book | null> {
    try {
      const r = await fetch(`${GEMINI}/v1/book/${encodeURIComponent(instrument)}?limit_bids=1&limit_asks=1`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { bids?: { price: string; amount: string }[]; asks?: { price: string; amount: string }[] };
      return { recv: Date.now(), bid: j.bids?.[0]?.price ?? null, bidSize: j.bids?.[0]?.amount ?? null, ask: j.asks?.[0]?.price ?? null, askSize: j.asks?.[0]?.amount ?? null };
    } catch {
      return null;
    }
  }
  close() {}
}

export type MarketState = { status: string; marketState: string | null; resolutionSide: "yes" | "no" | null; at: number };

/** Contract status from Gemini's public events endpoint. */
export async function fetchMarketState(eventTicker: string, contractTicker: string): Promise<MarketState | null> {
  try {
    const r = await fetch(`${GEMINI}/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const e = (await r.json()) as { status: string; contracts: { ticker: string; status: string; marketState?: string | null; resolutionSide?: "yes" | "no" | null }[] };
    const c = e.contracts.find((x) => x.ticker === contractTicker);
    if (!c) return null;
    return { status: c.status, marketState: c.marketState ?? null, resolutionSide: c.resolutionSide ?? null, at: Date.now() };
  } catch {
    return null;
  }
}

export type SamplerIo = {
  armed(signer: Address): Promise<ArmedPot[]>;
  submit(id: string, sub: SamplerSubmission): Promise<unknown>;
  samples(id: string, signer: Address, samples: { t: number; mid: number | null; status: number }[], signature: Hex): Promise<unknown>;
};

type PotState = {
  pot: ArmedPot;
  verified: boolean | null;
  samples: Sample[];
  nextAt: number;
  market: MarketState | null;
  marketAt: number;
  posted: number; // last sample time sent for the chart
  postedAt: number;
  done: Set<string>;
};

export type SamplerLog = (msg: string) => void;

export class Sampler {
  private pots = new Map<string, PotState>();
  private armedAt = 0;
  readonly address: Address;
  /** Market status lookup; replaceable in tests. */
  marketState: (eventTicker: string, contractTicker: string) => Promise<MarketState | null> = fetchMarketState;

  constructor(
    private account: LocalAccount,
    private source: BookSource,
    private io: SamplerIo,
    private client: PublicClient,
    private log: SamplerLog = () => {},
    /** Optional persisted samples (short-lived hosts reload their own samples each run). */
    private store?: { load(id: string): Promise<Sample[]>; save(id: string, s: Sample[]): Promise<void> },
  ) {
    this.address = getAddress(account.address);
  }

  get watching() {
    return this.pots.size;
  }

  private async verify(p: ArmedPot): Promise<boolean> {
    const expected = conditionIdForTrigger({ instrument: p.instrument, side: p.side, mode: p.mode, params: p.params });
    if (expected !== p.conditionId) return false;
    try {
      const pot = await this.client.readContract({ address: p.vault, abi: verdictVaultAbi, functionName: "getPot", args: [BigInt(p.potId)] });
      return pot.conditionId.toLowerCase() === expected.toLowerCase() && getAddress(pot.resolver) === getAddress(p.resolver) && pot.status === 1;
    } catch {
      return false;
    }
  }

  private async refresh(now: number) {
    if (now - this.armedAt < 15_000 && this.pots.size) return;
    this.armedAt = now;
    const list = await this.io.armed(this.address);
    const ids = new Set(list.map((p) => p.id));
    for (const id of [...this.pots.keys()]) if (!ids.has(id)) this.pots.delete(id);
    for (const p of list) {
      const s = this.pots.get(p.id);
      if (s) {
        s.pot = p;
        p.submitted.forEach((k) => s.done.add(k));
        continue;
      }
      const verified = await this.verify(p);
      if (!verified) this.log(`pot ${p.id}: conditionId, resolver or status does not match the chain; ignored`);
      const samples = this.store ? await this.store.load(p.id) : [];
      this.pots.set(p.id, { pot: p, verified, samples, nextAt: 0, market: null, marketAt: 0, posted: samples.at(-1)?.t ?? 0, postedAt: 0, done: new Set(p.submitted) });
    }
    this.source.watch([...new Set([...this.pots.values()].filter((s) => s.verified).map((s) => s.pot.instrument))]);
  }

  private async signOutcome(s: PotState, kind: "close" | "void" | "settle", outcome: boolean, reason: string) {
    const p = s.pot;
    const resolution = await this.account.signTypedData({
      domain: resolutionDomain(p.chainId, p.vault),
      types: resolutionTypes,
      primaryType: "Resolution",
      message: { potId: BigInt(p.potId), conditionId: p.conditionId, outcome },
    });
    await this.io.submit(p.id, { kind, signer: this.address, outcome, resolution, reason, observed: { ...(s.market ?? {}), sampler: this.address } });
    s.done.add(kind);
    this.log(`pot ${p.id}: signed ${kind} (${outcome ? "pay" : "no payout"}): ${reason}`);
  }

  /** One pass: sample what is due, decide, sign. Call it every few hundred milliseconds. */
  async step(now = Date.now()) {
    await this.refresh(now);
    for (const s of this.pots.values()) {
      if (!s.verified) continue;
      const p = s.pot;
      const lockMs = p.lockTime * 1000;
      const closeMs = p.tradingClose * 1000;

      if (now - s.marketAt > 20_000) {
        s.marketAt = now;
        s.market = (await this.marketState(p.eventTicker, p.contractTicker)) ?? s.market;
      }
      const m = s.market;
      const terminal = s.done.has("trigger") || s.done.has("close") || s.done.has("void") || s.done.has("settle");

      // Voided before any trigger: never pay.
      if (m?.status === "invalid" && !terminal) {
        await this.signOutcome(s, "void", false, "Gemini marked the market invalid (voided)");
        continue;
      }

      // Sample during the armed period (and the joining period, so a full window exists at lock).
      if (now < closeMs && now >= s.nextAt) {
        s.nextAt = (s.nextAt === 0 ? now : s.nextAt) + p.params.intervalMs;
        if (s.nextAt < now) s.nextAt = now + p.params.intervalMs;
        const b = await this.source.snapshot(p.instrument);
        const sample = classify({ t: now, dataT: b?.recv ?? 0, bid: b?.bid ?? null, bidSize: b?.bidSize ?? null, ask: b?.ask ?? null, askSize: b?.askSize ?? null }, p.params);
        const last = s.samples.at(-1);
        if (!last || sample.t > last.t) s.samples.push(sample);
        const keepFrom = now - p.params.windowMs * 2;
        if (s.samples.length > 10 && s.samples[0]!.t < keepFrom) s.samples = s.samples.filter((x) => x.t >= keepFrom);
        if (this.store) await this.store.save(p.id, s.samples);

        // Decide: armed, market open and not under review, a full window inside the armed period.
        const marketOpen = m && m.status === "active" && m.marketState !== "closed";
        if (!terminal && marketOpen && now - p.params.windowMs >= lockMs) {
          const armed = s.samples.filter((x) => x.t > lockMs);
          const d = evaluate(armed, p.params, p.side, now);
          if (d.triggered) {
            const { record } = buildRecord({
              chainId: p.chainId,
              vault: p.vault,
              potId: BigInt(p.potId),
              instrument: p.instrument,
              side: p.side,
              mode: p.mode,
              params: p.params,
              samples: armed,
              windowEnd: now,
              dataSource: this.source.name,
              signer: this.address,
            });
            const signed = await signTrigger(this.account, record);
            await this.io.submit(p.id, { kind: "trigger", record: recordToJson(record), attestation: signed.attestation, resolution: signed.resolution });
            s.done.add("trigger");
            this.log(`pot ${p.id}: TRIGGERED (average ${(Number(d.averageMicro) / 10 ** (p.params.priceDecimals + 6) * 100).toFixed(2)}%, ${d.validCount} valid samples)`);
          }
        }
      }

      // Trading closed (by time or by Gemini): arming ends; the pot mode decides.
      const closedNow = now >= closeMs || m?.marketState === "closed" || m?.status === "closed" || m?.status === "settled";
      if (closedNow && !terminal) {
        if (p.mode === "early-only") {
          await this.signOutcome(s, "close", false, "Trading closed without the threshold being crossed in this sampler's data");
        } else if (m?.status === "settled" && m.resolutionSide) {
          const occurred = m.resolutionSide === p.side;
          await this.signOutcome(s, "settle", occurred, `Gemini settled the contract ${m.resolutionSide.toUpperCase()}`);
        }
      }

      // Recent samples for the live chart, every 5 s.
      if (now - s.postedAt > 5_000) {
        const fresh = s.samples.filter((x) => x.t > s.posted);
        if (fresh.length) {
          const unit = 10 ** p.params.priceDecimals;
          const rows = fresh.map((x) => ({
            t: x.t,
            mid: x.bid > 0n && x.ask > 0n ? (p.side === "yes" ? Number(x.bid + x.ask) / 2 / unit : 1 - Number(x.bid + x.ask) / 2 / unit) : null,
            status: x.status,
          }));
          const signature = await this.account.signMessage({ message: JSON.stringify({ id: p.id, samples: rows }) });
          try {
            await this.io.samples(p.id, this.address, rows, signature);
            s.posted = fresh.at(-1)!.t;
          } catch (err) {
            this.log(`pot ${p.id}: could not post samples: ${(err as Error).message}`);
          }
        }
        s.postedAt = now;
      }
    }
  }
}

/** HTTP adapter for samplers running outside the app (local machine, GitHub Actions). */
export function httpIo(api: string): SamplerIo {
  const base = api.replace(/\/$/, "");
  const req = async (path: string, init?: RequestInit) => {
    const r = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 200)}`);
    return JSON.parse(text) as unknown;
  };
  return {
    armed: async (signer) => ((await req(`/api/early/armed?signer=${signer}`)) as { pots: ArmedPot[] }).pots,
    submit: (id, sub) => req(`/api/early/${id}/sign`, { method: "POST", body: JSON.stringify(sub) }),
    samples: (id, signer, samples, signature) => req(`/api/early/${id}/samples`, { method: "POST", body: JSON.stringify({ signer, samples, signature }) }),
  };
}
