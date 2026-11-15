import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAddress, recoverAddress, slice, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  aggregate,
  buildRecord,
  classify,
  conditionIdForTrigger,
  DECISION,
  encodeRecord,
  evaluate,
  evidenceHash,
  evidenceRootOf,
  fromBookTicker,
  fromDepth5,
  paramsFor,
  PROVISIONAL_DEFAULTS,
  recordFromJson,
  recordToJson,
  SAMPLE_STATUS,
  sampleFeed,
  signTrigger,
  toUnits,
  verifyRecord,
  type EvidenceRecord,
  type Sample,
  type TriggerParams,
} from "../src/trigger";

// ------------------------------------------------------------------ helpers

const DEMO = paramsFor("demo"); // 60 s window, 2 s interval, >= 25 valid, spread <= 4c, >= 10 per side, stale <= 10 s
const T0 = 1_800_000_000_000; // fixed epoch ms, so every run is identical

type Q = { mid: number; spread?: number; size?: number; lag?: number; oneSided?: boolean };
/** A synthetic sampled feed: one sample per interval, price given per second since T0. */
function feed(seconds: number, at: (s: number) => Q, p: TriggerParams = DEMO): Sample[] {
  const out: Sample[] = [];
  for (let t = p.intervalMs; t <= seconds * 1000; t += p.intervalMs) {
    const q = at(t / 1000);
    const half = (q.spread ?? 0.02) / 2;
    const cents = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
    out.push(
      classify(
        {
          t: T0 + t,
          dataT: T0 + t - (q.lag ?? 0),
          bid: cents(q.mid - half),
          ask: q.oneSided ? null : cents(q.mid + half),
          bidSize: String(q.size ?? 50),
          askSize: q.oneSided ? null : String(q.size ?? 50),
        },
        p,
      ),
    );
  }
  return out;
}
const end = (seconds: number) => T0 + seconds * 1000;

const KEYS = [
  "0x1111111111111111111111111111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333333333333333333333333333",
] as const;
const SIGNERS = KEYS.map((k) => privateKeyToAccount(k));
const VAULT = getAddress("0xba7190441bc00fC1AC8597d68197039e1167E6D4");
const INSTRUMENT = "GEMI-WXHIGH-AUS-2611160459-LO60";
const POT = 4242n;

function recordFor(signerIdx: number, samples: Sample[], windowEnd: number, p: TriggerParams = DEMO) {
  return buildRecord({
    chainId: 5042002,
    vault: VAULT,
    potId: POT,
    instrument: INSTRUMENT,
    side: "yes",
    mode: "early-only",
    params: p,
    samples,
    windowEnd,
    dataSource: "gemini:wss://ws.gemini.com:depth5",
    signer: SIGNERS[signerIdx]!.address,
  });
}
const expected = () => ({
  chainId: 5042002,
  vault: VAULT,
  potId: POT,
  conditionId: conditionIdForTrigger({ instrument: INSTRUMENT, side: "yes", mode: "early-only", params: DEMO }),
  signers: SIGNERS.map((s) => s.address),
  threshold: 2,
});

/** Rises linearly from 0.70 to 0.95 over 120 s, then holds. */
const rising = (s: number): Q => ({ mid: Math.min(0.95, 0.7 + (0.25 * s) / 120) });

// ------------------------------------------------------------------ parameters

describe("parameters", () => {
  it("provisional defaults convert to market units", () => {
    expect(DEMO).toMatchObject({ thresholdBps: 8500, windowMs: 60_000, intervalMs: 2_000, minValidSamples: 25, maxSpreadUnits: 4, minSizeUnits: 1000, maxStalenessMs: 10_000 });
    expect(paramsFor("standard")).toMatchObject({ windowMs: 1_800_000, intervalMs: 10_000, minValidSamples: 150, maxSpreadUnits: 5, minSizeUnits: 5000, maxStalenessMs: 60_000 });
    expect(PROVISIONAL_DEFAULTS.standard.thresholdBps).toBe(8500);
  });

  it("parses exact decimals and rejects values off the market increment", () => {
    expect(toUnits("0.8300", 2)).toBe(83n);
    expect(toUnits("100.00", 2)).toBe(10000n);
    expect(toUnits("0.835", 2)).toBeNull();
    expect(toUnits("abc", 2)).toBeNull();
  });

  it("rejects impossible parameters", () => {
    expect(() => paramsFor("demo", {}, { minValidSamples: 40 })).toThrow(/cannot exceed/);
    expect(() => paramsFor("demo", {}, { thresholdBps: 0 })).toThrow(/threshold/);
  });

  it("the conditionId commits to every parameter, the side, the mode and the contract", () => {
    const base = { instrument: INSTRUMENT, side: "yes" as const, mode: "early-only" as const, params: DEMO };
    const id = conditionIdForTrigger(base);
    expect(conditionIdForTrigger(base)).toBe(id);
    const variants = [
      { ...base, instrument: "GEMI-OTHER" },
      { ...base, side: "no" as const },
      { ...base, mode: "early-or-outcome" as const },
      ...(Object.keys(DEMO) as (keyof TriggerParams)[]).map((k) => ({ ...base, params: { ...DEMO, [k]: DEMO[k] + 1 } })),
    ];
    for (const v of variants) expect(conditionIdForTrigger(v)).not.toBe(id);
  });
});

// ------------------------------------------------------------------ the rule (synthetic feeds)

describe("trigger rule", () => {
  it("a steady rise triggers once the window average is above the threshold", () => {
    const s = feed(240, rising);
    expect(evaluate(s, DEMO, "yes", end(60)).code).toBe(DECISION.below_threshold);
    const d = evaluate(s, DEMO, "yes", end(240));
    expect(d.triggered).toBe(true);
    expect(d.validCount).toBe(30);
    expect(d.averageMicro).toBe(95_000_000n); // 0.95 in micro cents
  });

  it("a single tick never triggers, however high", () => {
    const s = feed(2, () => ({ mid: 0.99 }));
    expect(evaluate(s, DEMO, "yes", end(2)).code).toBe(DECISION.insufficient_samples);
  });

  it("a short spike does not trigger", () => {
    // 0.70 baseline, 6 s at 0.99 (three samples), checked at every point of and after the spike
    const s = feed(120, (t) => ({ mid: t > 80 && t <= 86 ? 0.99 : 0.7 }));
    for (let w = 80; w <= 120; w += 2) {
      const d = evaluate(s, DEMO, "yes", end(w));
      expect(d.triggered).toBe(false);
    }
    expect(evaluate(s, DEMO, "yes", end(86)).averageMicro).toBeLessThan(80_000_000n);
  });

  it("a wide spread does not trigger", () => {
    const s = feed(120, () => ({ mid: 0.93, spread: 0.1 }));
    const d = evaluate(s, DEMO, "yes", end(120));
    expect(s.every((x) => x.status === SAMPLE_STATUS.spread)).toBe(true);
    expect(d.code).toBe(DECISION.insufficient_samples);
  });

  it("thin size does not trigger", () => {
    const s = feed(120, () => ({ mid: 0.93, size: 5 }));
    expect(s[0]!.status).toBe(SAMPLE_STATUS.bid_size);
    expect(evaluate(s, DEMO, "yes", end(120)).code).toBe(DECISION.insufficient_samples);
  });

  it("a one-sided book does not trigger", () => {
    const s = feed(120, () => ({ mid: 0.93, oneSided: true }));
    expect(s[0]!.status).toBe(SAMPLE_STATUS.missing_side);
    expect(evaluate(s, DEMO, "yes", end(120)).triggered).toBe(false);
  });

  it("stale data does not trigger", () => {
    const s = feed(120, () => ({ mid: 0.93, lag: 15_000 }));
    expect(s[0]!.status).toBe(SAMPLE_STATUS.stale);
    expect(evaluate(s, DEMO, "yes", end(120)).code).toBe(DECISION.insufficient_samples);
  });

  it("data that stops before the window ends does not trigger", () => {
    const p = { ...DEMO, minValidSamples: 15 };
    const s = feed(120, () => ({ mid: 0.93 }), p).filter((x) => x.t <= end(100));
    expect(evaluate(s, p, "yes", end(120)).code).toBe(DECISION.stale_at_end);
  });

  it("an outage inside the window: invalid samples do not count; too few valid ones means no trigger", () => {
    const brief = feed(120, (t) => ({ mid: 0.93, spread: t > 100 && t <= 106 ? 0.2 : 0.02 }));
    expect(evaluate(brief, DEMO, "yes", end(120)).triggered).toBe(true); // 27 valid of 30
    const long = feed(120, (t) => ({ mid: 0.93, spread: t > 80 && t <= 100 ? 0.2 : 0.02 }));
    expect(evaluate(long, DEMO, "yes", end(120)).code).toBe(DECISION.insufficient_samples); // 20 valid
  });

  it("invalid samples carry no weight in the average", () => {
    // valid at 0.90 throughout, but a wide-spread stretch quoted around 0.50 must not pull the average down
    const s = feed(120, (t) => (t > 100 && t <= 104 ? { mid: 0.5, spread: 0.3 } : { mid: 0.9 }));
    const d = evaluate(s, DEMO, "yes", end(120));
    expect(d.averageMicro).toBe(90_000_000n);
    expect(d.triggered).toBe(true);
  });

  it("the NO side uses 1 - midpoint", () => {
    const s = feed(120, () => ({ mid: 0.1 }));
    expect(evaluate(s, DEMO, "no", end(120)).averageMicro).toBe(90_000_000n);
    expect(evaluate(s, DEMO, "no", end(120)).triggered).toBe(true);
    expect(evaluate(s, DEMO, "yes", end(120)).triggered).toBe(false);
  });

  it("is exactly at the threshold inclusive", () => {
    const s = feed(120, () => ({ mid: 0.85 }));
    expect(evaluate(s, DEMO, "yes", end(120)).triggered).toBe(true);
    const below = feed(120, (t) => ({ mid: t > 110 ? 0.83 : 0.85 }));
    expect(evaluate(below, DEMO, "yes", end(120)).triggered).toBe(false);
  });

  it("rejects samples out of order", () => {
    const s = feed(10, () => ({ mid: 0.9 }));
    expect(() => evaluate([s[1]!, s[0]!], DEMO, "yes", end(10))).toThrow(/order/);
  });
});

// ------------------------------------------------------------------ recorded feeds

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

/** Replays a recorded depth5 fixture through the sampler: the last 60 s of the recording. */
function depth(name: string, p: TriggerParams = DEMO) {
  const updates = fixture(name).filter((m) => m.bids || m.asks).map(fromDepth5);
  const last = updates[updates.length - 1]!.recv;
  const samples = sampleFeed(updates, p, last - 60_000 + p.intervalMs, last);
  return { samples, at: samples[samples.length - 1]!.t };
}

describe("recorded Gemini feeds (replay)", () => {
  it("a 5-minute crypto book (bookTicker, 150 s): its quotes fail the demo spread/size rules, so no trigger", () => {
    const updates = fixture("gemi-btc05m2611150045-up.jsonl").map(fromBookTicker);
    const from = updates[0]!.recv;
    const s = sampleFeed(updates, DEMO, from, from + 150_000);
    const d = evaluate(s, DEMO, "yes", s[s.length - 1]!.t);
    expect(d.triggered).toBe(false);
    // replay is deterministic
    expect(evaluate(sampleFeed(updates, DEMO, from, from + 150_000), DEMO, "yes", s[s.length - 1]!.t)).toEqual(d);
  });

  it("a quiet book seen through bookTicker looks stale; the same book through depth5 is fresh", () => {
    const quiet = fixture("gemi-wxhigh-aus-2611160459-lo60.jsonl").map(fromBookTicker);
    const t = quiet[0]!.recv + 60_000;
    const viaTicker = sampleFeed(quiet, DEMO, t - 58_000, t);
    expect(viaTicker.every((x) => x.status === SAMPLE_STATUS.stale)).toBe(true);
    const viaDepth = depth("gemi-wxhigh-aus-2611160459-lo60.depth5.jsonl");
    expect(viaDepth.samples.every((x) => x.status === SAMPLE_STATUS.ok)).toBe(true);
  });

  it("a real weather book (depth5, Austin 60F or below, ~81%): valid samples, below 85% -> no trigger; the same feed under an 80% rule triggers", () => {
    const { samples, at } = depth("gemi-wxhigh-aus-2611160459-lo60.depth5.jsonl");
    const d = evaluate(samples, DEMO, "yes", at);
    expect(d.code).toBe(DECISION.below_threshold);
    expect(d.validCount).toBeGreaterThanOrEqual(25);
    expect(d.averageMicro).toBe(81_500_000n); // bid 0.80 / ask 0.83 throughout the recording
    const p80 = { ...DEMO, thresholdBps: 8000 };
    expect(evaluate(depth("gemi-wxhigh-aus-2611160459-lo60.depth5.jsonl", p80).samples, p80, "yes", at).triggered).toBe(true);
  });

  it("a real 5-minute crypto book (depth5): fails the demo spread/size rules -> no trigger", () => {
    const { samples, at } = depth("gemi-btc05m2611150050-up.depth5.jsonl");
    const d = evaluate(samples, DEMO, "yes", at);
    expect(d.triggered).toBe(false);
    expect(samples.some((x) => x.status !== SAMPLE_STATUS.ok)).toBe(true);
  });
});

// ------------------------------------------------------------------ evidence

describe("evidence records", () => {
  const samples = feed(240, rising);
  const { record, decision } = recordFor(0, samples, end(240));

  it("recomputing from a record reproduces the decision (also after a JSON round trip)", () => {
    expect(decision.triggered).toBe(true);
    expect(verifyRecord(record)).toEqual(decision);
    const back = recordFromJson(JSON.parse(JSON.stringify(recordToJson(record))));
    expect(verifyRecord(back)).toEqual(decision);
    expect(encodeRecord(back)).toBe(encodeRecord(record));
    expect(evidenceHash(back)).toBe(evidenceHash(record));
  });

  it("serialisation is identical across runs and machines (pinned hash)", () => {
    const again = recordFor(0, feed(240, rising), end(240)).record;
    expect(encodeRecord(again)).toBe(encodeRecord(record));
    expect(evidenceHash(record)).toBe(PINNED_HASH);
  });

  it("contains only integers and strings", () => {
    const json = JSON.stringify(recordToJson(record));
    expect(json).not.toMatch(/\d\.\d/); // no decimal points anywhere
    expect(record.samples).toHaveLength(30);
  });

  it("a changed sample changes the hash", () => {
    const changed: EvidenceRecord = { ...record, samples: record.samples.map((s, i) => (i === 7 ? { ...s, bid: s.bid - 1n } : s)) };
    expect(evidenceHash(changed)).not.toBe(evidenceHash(record));
    const retimed: EvidenceRecord = { ...record, samples: record.samples.map((s, i) => (i === 0 ? { ...s, t: s.t + 1 } : s)) };
    expect(evidenceHash(retimed)).not.toBe(evidenceHash(record));
  });

  it("a record that fails its own rule is rejected", () => {
    const bad = (r: Partial<EvidenceRecord>, msg: RegExp) => expect(() => verifyRecord({ ...record, ...r })).toThrow(msg);
    bad({ averageMicro: record.averageMicro + 1n }, /average/);
    bad({ validCount: record.validCount + 1 }, /validCount/);
    bad({ decision: DECISION.below_threshold }, /decision/);
    bad({ params: { ...record.params, thresholdBps: 5000 } }, /conditionId/); // looser rule than committed
    bad({ windowStart: record.windowStart + 2000 }, /window/);
    // a sample whose status does not follow from its own values
    bad({ samples: record.samples.map((s, i) => (i === 3 ? { ...s, status: SAMPLE_STATUS.spread } : s)) }, /status/);
    // a low sample hidden by marking it invalid changes the average -> rejected
    const lowered = recordFor(0, feed(240, (t) => (t === 230 ? { mid: 0.6 } : rising(t))), end(240)).record;
    bad({ samples: lowered.samples }, /average|decision|validCount/);
    // a non-triggering record claiming to trigger
    const flat = recordFor(0, feed(240, () => ({ mid: 0.8 })), end(240)).record;
    expect(() => verifyRecord({ ...flat, decision: DECISION.triggered })).toThrow(/decision/);
  });
});

// ------------------------------------------------------------------ signers

describe("multi-signer trigger", () => {
  // Each signer samples independently: slightly different timing and quotes, same market.
  const own = (k: number) => recordFor(k, feed(240, (t) => ({ mid: rising(t).mid - (k === 2 ? 0.01 : 0) })), end(240) + k * 500).record;

  it("two of three valid signers trigger; root, order and resolver signature are deterministic", async () => {
    const subs = await Promise.all([0, 1].map((k) => signTrigger(SIGNERS[k]!, own(k))));
    const a = await aggregate(subs, expected());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const sorted = [...SIGNERS.slice(0, 2).map((s) => s.address)].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
    expect(a.signers).toEqual(sorted);
    expect(a.evidenceRoot).toBe(evidenceRootOf(a.signers.map((s) => evidenceHash(subs.find((x) => x.record.signer === s)!.record))));
    // the concatenated signature is what MultisigResolver expects: one 65-byte signature per signer, ascending
    expect((a.resolverSignature.length - 2) / 2).toBe(130);
    for (const [i, s] of a.signers.entries()) {
      expect(getAddress(await recoverAddress({ hash: a.resolutionDigest, signature: slice(a.resolverSignature, i * 65, (i + 1) * 65) }))).toBe(s);
    }
    // submission order does not matter
    const b = await aggregate([...subs].reverse(), expected());
    expect(b.ok && b.evidenceRoot).toBe(a.evidenceRoot);
  });

  it("missing signers do not trigger", async () => {
    const one = await aggregate([await signTrigger(SIGNERS[0]!, own(0))], expected());
    expect(one.ok).toBe(false);
    expect(await aggregate([], expected())).toMatchObject({ ok: false, accepted: 0 });
  });

  it("the same signer twice, an outsider, a bad signature or another pot cannot make up a missing signer", async () => {
    const s0 = await signTrigger(SIGNERS[0]!, own(0));
    const outsider = privateKeyToAccount("0x4444444444444444444444444444444444444444444444444444444444444444");
    const foreign = await signTrigger(outsider, buildRecord({ ...base(outsider.address), samples: feed(240, rising) }).record);
    const forged = { ...(await signTrigger(SIGNERS[1]!, own(1))), attestation: s0.attestation }; // signer 1's record, signer 0's signature
    const otherPot = await signTrigger(SIGNERS[2]!, buildRecord({ ...base(SIGNERS[2]!.address), potId: POT + 1n, samples: feed(240, rising) }).record);
    for (const extra of [s0, foreign, forged, otherPot]) {
      const a = await aggregate([s0, extra], expected());
      expect(a.ok).toBe(false);
    }
  });

  it("a signer whose own record does not trigger cannot sign, and a tampered record is rejected", async () => {
    const flat = recordFor(1, feed(240, () => ({ mid: 0.8 })), end(240)).record;
    await expect(signTrigger(SIGNERS[1]!, flat)).rejects.toThrow(/does not trigger/);
    const s0 = await signTrigger(SIGNERS[0]!, own(0));
    const s1 = await signTrigger(SIGNERS[1]!, own(1));
    const tampered = { ...s1, record: { ...s1.record, samples: s1.record.samples.map((s, i) => (i === 2 ? { ...s, bid: s.bid + 1n, ask: s.ask + 1n } : s)) } };
    const a = await aggregate([s0, tampered], expected());
    expect(a.ok).toBe(false);
  });
});

function base(signer: Address) {
  return {
    chainId: 5042002,
    vault: VAULT,
    potId: POT,
    instrument: INSTRUMENT,
    side: "yes" as const,
    mode: "early-only" as const,
    params: DEMO,
    windowEnd: end(240),
    dataSource: "gemini:wss://ws.gemini.com:depth5",
    signer,
  };
}

/** keccak256 of the canonical record of signer 0 over the rising feed. Must never change without an engine version bump. */
const PINNED_HASH: Hex = "0x70460fff481d1863d7c8cad854f8e5ea822abd02e02ef7d4f2b4bcfaef03be67";
