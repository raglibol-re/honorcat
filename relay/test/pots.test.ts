import { describe, expect, it } from "vitest";
import { getAddress, recoverAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KIND, propose, potConditionId, potParams, rootOf, windowDigest, wouldCosign, type Avg, type WindowAtt } from "../src/pots";
import { PotSampler, type PotsIo, type PotsWork } from "../src/potsSampler";
import type { BookSource } from "../src/sampler";
import { evidenceHash, recordFromJson, verifyRecord } from "../src/trigger/evidence";
import { paramsFor } from "../src/trigger/params";

const a = (n: number, ppm: number, valid = true): Avg => ({
  signer: getAddress(`0x${String(n).repeat(40)}`),
  ppm: BigInt(ppm),
  valid,
  sampleCount: 10,
  evidenceHash: `0x${String(n).repeat(64)}` as Hex,
});

describe("price agreement", () => {
  it("three valid averages: the exact median", () => {
    const p = propose([a(1, 610_000), a(2, 500_000), a(3, 612_000)]);
    expect(p).toMatchObject({ valid: true, ppm: 610_000n });
  });
  it("two within 0.5 points: their mean", () => {
    expect(propose([a(1, 610_000), a(2, 614_000)])).toMatchObject({ valid: true, ppm: 612_000n });
    expect(propose([a(1, 610_000), a(2, 615_000)])).toMatchObject({ valid: true, ppm: 612_500n });
  });
  it("two more than 0.5 points apart: no agreement", () => {
    expect(propose([a(1, 610_000), a(2, 615_001)]).valid).toBe(false);
  });
  it("an invalid window does not count; one valid average is never enough", () => {
    expect(propose([a(1, 610_000), a(2, 611_000, false), a(3, 900_000, false)]).valid).toBe(false);
    expect(propose([a(1, 610_000), a(2, 611_000), a(3, 900_000, false)])).toMatchObject({ valid: true, ppm: 610_500n });
  });
  it("co-signs only within 0.5 points of its own average; always co-signs 'no price'", () => {
    expect(wouldCosign({ ppm: 610_000n, valid: true }, { valid: true, priceYes: 615_000 })).toBe(true);
    expect(wouldCosign({ ppm: 610_000n, valid: true }, { valid: true, priceYes: 615_001 })).toBe(false);
    expect(wouldCosign(null, { valid: true, priceYes: 615_000 })).toBe(false);
    expect(wouldCosign({ ppm: 0n, valid: false }, { valid: true, priceYes: 1 })).toBe(false);
    expect(wouldCosign(null, { valid: false, priceYes: 0 })).toBe(true);
  });
  it("the evidence root does not depend on the order of reports", () => {
    expect(rootOf([a(1, 1), a(2, 2), a(3, 3)])).toBe(rootOf([a(3, 3), a(1, 1), a(2, 2)]));
  });
});

const POTS = getAddress("0xc890C990048f45cb268d076E4A3dB25270Ea1e59");
const CHAIN = 5042002;
const KEY = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const T0 = 1_800_000_000_000;
const INSTR = "GEMI-WXHIGH-AUS-2611160459-LO60";

describe("pot sampler", () => {
  const params = potParams(paramsFor("demo"), 30, 10);
  const conditionId = potConditionId(INSTR, params);

  function harness(mid: () => [string, string]) {
    let now = T0;
    const posted: { id: string; body: { signer: Address; record: unknown; signature: Hex } }[] = [];
    const cosigned: { id: string; signature: Hex }[] = [];
    let work: PotsWork = { now: 0, measure: [], cosign: [], levels: [], pots: POTS, chainId: CHAIN };
    const source: BookSource = {
      name: "test",
      watch() {},
      async snapshot() {
        const [bid, ask] = mid();
        return { recv: now, bid, bidSize: "100.00", ask, askSize: "100.00" };
      },
      close() {},
    };
    const io: PotsIo = {
      work: async () => work,
      average: async (id, body) => void posted.push({ id, body }),
      cosign: async (id, body) => void cosigned.push({ id, signature: body.signature }),
      level: async () => ({}),
    };
    const s = new PotSampler(privateKeyToAccount(KEY), source, io);
    return {
      s,
      posted,
      cosigned,
      setWork: (w: Partial<PotsWork>) => (work = { ...work, ...w }),
      async run(untilMs: number) {
        for (; now <= untilMs; now += 500) await s.step(now);
      },
    };
  }

  it("measures exactly the requested window, signs its own average, then co-signs a close proposal", async () => {
    const h = harness(() => ["0.60", "0.62"]);
    const start = T0 / 1000 + 5;
    h.setWork({ measure: [{ requestId: "w:1:0:1", potId: "1", kind: KIND.exit, windowStart: start, windowEnd: start + 30, instrument: INSTR, params, conditionId }] });
    await h.run(T0 + 30_000);
    expect(h.posted).toHaveLength(0); // the window is not over
    await h.run(T0 + 38_000);
    expect(h.posted).toHaveLength(1);
    const rec = recordFromJson(h.posted[0]!.body.record as never);
    expect(rec.conditionId).toBe(conditionId);
    expect(rec.windowStart).toBe(start * 1000);
    expect(rec.windowEnd).toBe((start + 30) * 1000);
    const d = verifyRecord(rec);
    expect(d.validCount).toBeGreaterThanOrEqual(10);
    expect(rec.averageMicro / 100n).toBe(610_000n);
    const signer = await recoverMessageAddress({ message: { raw: evidenceHash(rec) }, signature: h.posted[0]!.body.signature });
    expect(signer).toBe(privateKeyToAccount(KEY).address);

    const att = (priceYes: number): WindowAtt => ({ potId: "1", kind: KIND.exit, nonce: "0", windowStart: String(start), windowEnd: String(start + 30), sampleCount: 15, priceYes, valid: true, evidenceHash: `0x${"ab".repeat(32)}` });
    const near = att(613_000);
    const far = att(620_000);
    const at = { chainId: CHAIN, pots: POTS };
    h.setWork({
      measure: [],
      cosign: [
        { requestId: "w:1:0:1", kind: "window", digest: windowDigest(near, at), payload: { attestation: near } },
        { requestId: "w:2:0:1", kind: "window", digest: windowDigest(far, at), payload: { attestation: far } },
      ],
    });
    await h.run(T0 + 45_000);
    expect(h.cosigned.map((c) => c.id)).toEqual(["w:1:0:1"]); // w:2 has no own average: not signed
    expect(await recoverAddress({ hash: windowDigest(near, at), signature: h.cosigned[0]!.signature })).toBe(privateKeyToAccount(KEY).address);
  });

  it("does not co-sign a proposal whose digest does not match its payload", async () => {
    const h = harness(() => ["0.60", "0.62"]);
    const x: WindowAtt = { potId: "1", kind: KIND.join, nonce: "0", windowStart: "1", windowEnd: "31", sampleCount: 0, priceYes: 0, valid: false, evidenceHash: `0x${"00".repeat(32)}` };
    h.setWork({ cosign: [{ requestId: "r", kind: "window", digest: `0x${"12".repeat(32)}`, payload: { attestation: x } }] });
    await h.run(T0 + 1_000);
    expect(h.cosigned).toHaveLength(0);
  });
});
