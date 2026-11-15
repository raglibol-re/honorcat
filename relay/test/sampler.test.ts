import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Sampler, type Book, type BookSource, type MarketState, type SamplerIo } from "../src/sampler";
import { aggregate, recordFromJson } from "../src/trigger/evidence";
import { conditionIdForTrigger, paramsFor } from "../src/trigger/params";
import type { ArmedPot, SamplerSubmission } from "../src/early";

const VAULT = getAddress("0xba7190441bc00fC1AC8597d68197039e1167E6D4");
const RESOLVER = getAddress("0x81d1194069E1aD3a22C17356065d8dF6A4D436c9");
const KEYS = ["0x1111111111111111111111111111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222222222222222222222222222"] as const;
const DEMO = paramsFor("demo");
const T0 = 1_800_000_000_000;

function pot(over: Partial<ArmedPot> = {}): ArmedPot {
  const base = { instrument: "GEMI-WXHIGH-AUS-2611160459-LO60", side: "yes" as const, mode: "early-only" as const, params: DEMO };
  return {
    id: "p1",
    potId: "77",
    gid: "5",
    chainId: 5042002,
    vault: VAULT,
    resolver: RESOLVER,
    conditionId: conditionIdForTrigger(base),
    eventTicker: "WXHIGH-AUS-2611160459",
    contractTicker: "LO60",
    lockTime: T0 / 1000 + 30,
    tradingClose: T0 / 1000 + 600,
    deadline: T0 / 1000 + 3600,
    submitted: [],
    ...base,
    ...over,
  };
}

/** A fake order book, chain and app, driven by a fake clock. */
function harness(key: (typeof KEYS)[number], p: ArmedPot, quote: (t: number) => Partial<Book>, market: (t: number) => MarketState) {
  let now = T0;
  const subs: SamplerSubmission[] = [];
  const source: BookSource = {
    name: "test",
    watch() {},
    async snapshot() {
      return { recv: now, bid: "0.93", bidSize: "100.00", ask: "0.95", askSize: "100.00", ...quote(now) };
    },
    close() {},
  };
  const io: SamplerIo = {
    armed: async () => [{ ...p, submitted: subs.map((s) => s.kind) }],
    submit: async (_id, sub) => void subs.push(sub),
    samples: async () => ({}),
  };
  const client = {
    readContract: async () => ({ conditionId: p.conditionId, resolver: RESOLVER, status: 1 }),
  };
  const s = new Sampler(privateKeyToAccount(key), source, io, client as never);
  s.marketState = async () => market(now);
  return {
    subs,
    async run(untilMs: number) {
      for (; now <= untilMs; now += 500) await s.step(now);
    },
  };
}

const open = (): MarketState => ({ status: "active", marketState: "open", resolutionSide: null, at: 0 });

describe("sampler", () => {
  it("samples, waits for a full armed window, then signs a trigger whose evidence passes aggregation", async () => {
    const p = pot();
    const runs = await Promise.all(
      KEYS.map(async (k) => {
        const h = harness(k, p, () => ({}), open);
        await h.run(T0 + 30_000 + 50_000); // armed for 50 s: not yet a full window
        expect(h.subs).toHaveLength(0);
        await h.run(T0 + 30_000 + 75_000);
        return h.subs;
      }),
    );
    const subs = runs.flat();
    expect(subs.map((s) => s.kind)).toEqual(["trigger", "trigger"]);
    const signed = subs.map((s) => {
      if (s.kind !== "trigger") throw new Error("unexpected");
      return { record: recordFromJson(s.record), attestation: s.attestation, resolution: s.resolution };
    });
    for (const x of signed) expect(x.record.windowStart).toBeGreaterThanOrEqual(p.lockTime * 1000);
    const signers = KEYS.map((k) => privateKeyToAccount(k).address as Address);
    const a = await aggregate(signed, { chainId: p.chainId, vault: p.vault, potId: 77n, conditionId: p.conditionId, signers, threshold: 2 });
    expect(a.ok).toBe(true);
  });

  it("does not trigger on a wide spread, and signs 'close' (no payout) when trading closes", async () => {
    const p = pot({ tradingClose: T0 / 1000 + 150 });
    const h = harness(KEYS[0], p, () => ({ bid: "0.80", ask: "0.99" }), open);
    await h.run(T0 + 160_000);
    expect(h.subs.map((s) => s.kind)).toEqual(["close"]);
    expect(h.subs[0]).toMatchObject({ outcome: false });
  });

  it("does not trigger while the market is under review", async () => {
    const p = pot();
    const h = harness(KEYS[0], p, () => ({}), () => ({ status: "under_review", marketState: "open", resolutionSide: null, at: 0 }));
    await h.run(T0 + 200_000);
    expect(h.subs).toHaveLength(0);
  });

  it("signs 'void' (no payout) when the market is voided before a trigger", async () => {
    const p = pot();
    const h = harness(KEYS[0], p, () => ({}), (t) => (t > T0 + 20_000 ? { status: "invalid", marketState: "closed", resolutionSide: null, at: 0 } : open()));
    await h.run(T0 + 60_000);
    expect(h.subs.map((s) => [s.kind, "outcome" in s ? s.outcome : true])).toEqual([["void", false]]);
  });

  it("early-or-outcome: no trigger, then pays at settlement if the event occurred", async () => {
    const base = { instrument: "GEMI-WXHIGH-AUS-2611160459-LO60", side: "yes" as const, mode: "early-or-outcome" as const, params: DEMO };
    const p = pot({ mode: "early-or-outcome", conditionId: conditionIdForTrigger(base), tradingClose: T0 / 1000 + 150 });
    const h = harness(KEYS[0], p, () => ({ bid: "0.40", ask: "0.42" }), (t) =>
      t < T0 + 150_000 ? open() : t < T0 + 200_000 ? { status: "closed", marketState: "closed", resolutionSide: null, at: 0 } : { status: "settled", marketState: "closed", resolutionSide: "yes", at: 0 },
    );
    await h.run(T0 + 190_000);
    expect(h.subs).toHaveLength(0); // closed, not settled: wait
    await h.run(T0 + 230_000);
    expect(h.subs.map((s) => [s.kind, "outcome" in s ? s.outcome : true])).toEqual([["settle", true]]);
  });

  it("ignores a pot whose conditionId does not commit to its parameters", async () => {
    const p = pot({ params: { ...DEMO, thresholdBps: 5000 } }); // the app claims a looser rule than committed
    const h = harness(KEYS[0], p, () => ({}), open);
    await h.run(T0 + 200_000);
    expect(h.subs).toHaveLength(0);
  });
});
