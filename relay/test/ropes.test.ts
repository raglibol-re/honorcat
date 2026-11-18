import { hashTypedData, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { averageTyped, depthDigest, outcomeDigest, windowDigest, type At } from "../src/pots";
import { atPost, chainPotId, expiryWindowStart, isRopeDbId, knockWindowOk, leverageOf, lockoutS, ropeDbId, ROPE_BASE } from "../src/ropes";

// Vectors from contracts/test/ropes/RopesDigests.t.sol (HonorCatRopes at 0x…a1, MedianResolver at 0x…b2).
const ROPES = "0x00000000000000000000000000000000000000a1" as Address;
const MEDIAN = "0x00000000000000000000000000000000000000b2" as Address;
const at: At = { chainId: 5042002, pots: ROPES, name: "HonorCatRopes" };

describe("v2 digests match the contracts", () => {
  it("window", () => {
    const w = { potId: "7", kind: 7, nonce: "3", windowStart: "1800000001", windowEnd: "1800000031", sampleCount: 12, priceYes: 395_000, valid: true, evidenceHash: `0x${"0".repeat(61)}abc` as Hex };
    expect(windowDigest(w, at)).toBe("0x635d8f04aa8e86dbc22eb7b95c7fc6542b313cbf2621451edee1934bdbdfd31d");
  });
  it("depth with spread and category", () => {
    const d = { conditionId: `0x${"0".repeat(60)}c0de` as Hex, account: "0x000000000000000000000000000000000000beef" as Address, contracts5c: "123456", spread: 20_000, crypto: true, closeTime: "1800100000", validUntil: "1800000120" };
    expect(depthDigest(d, at)).toBe("0xf10c67021f3b9e119a2a91c729f67ea90769353035fdcf5ac74838182fbe88c9");
  });
  it("outcome", () => {
    const o = { potId: "7", conditionId: `0x${"0".repeat(60)}c0de` as Hex, outcome: 1, evidenceHash: `0x${"0".repeat(64)}` as Hex };
    expect(outcomeDigest(o, at)).toBe("0x49c1509c0e9c05a74a3e0d55e22cb5fcba83cc04fa18e421054043d98598504e");
  });
  it("a sampler's own average for the v2 MedianResolver", () => {
    const typed = averageTyped(
      MEDIAN,
      { potId: "7", kind: 7, nonce: "3", windowStart: 1_800_000_001, windowEnd: 1_800_000_031 },
      { priceYes: 396_000, valid: true, sampleCount: 14, evidenceHash: `0x${"0".repeat(60)}feed` as Hex },
      { chainId: 5042002, pots: ROPES },
    );
    expect(hashTypedData(typed)).toBe("0x56a2217b42cf3909bea4181cc76127865cfc37addd506afab17565d73084bcec");
  });
});

describe("v2 helpers", () => {
  it("keeps v2 pot ids in their own range", () => {
    expect(ropeDbId(5n, ROPE_BASE)).toBe((ROPE_BASE + 5n).toString());
    expect(isRopeDbId(ropeDbId(5n, ROPE_BASE))).toBe(true);
    expect(isRopeDbId("5")).toBe(false);
    expect(chainPotId(ropeDbId(42n, ROPE_BASE))).toBe(42n);
    // v2.1 pots have their own range (2e9): the chain id is the id within the range
    expect(chainPotId("2000000042")).toBe(42n);
    expect(chainPotId("42")).toBe(42n);
  });
  it("expiry windows are fixed by the expiry, as in the contract", () => {
    expect(expiryWindowStart(1000, 30, 0)).toBe(1001);
    expect(expiryWindowStart(1000, 30, 2)).toBe(1001 + 2 * 90);
  });
  it("a post at 0 or 100 never knocks out", () => {
    expect(atPost(400_000, 400_000, 1_000_000)).toBe("lower");
    expect(atPost(400_001, 400_000, 1_000_000)).toBe(null);
    expect(atPost(1_000_000, 400_000, 1_000_000)).toBe(null);
    expect(atPost(0, 0, 600_000)).toBe(null);
    expect(atPost(600_000, 0, 600_000)).toBe("upper");
  });
  it("knock-out windows start after the posts moved and end before the lock-out", () => {
    expect(lockoutS(30)).toBe(120);
    expect(knockWindowOk({ windowEnd: 1100, window: 30, armedAt: 1069, expiry: 2000 })).toBe(true);
    expect(knockWindowOk({ windowEnd: 1100, window: 30, armedAt: 1070, expiry: 2000 })).toBe(false);
    expect(knockWindowOk({ windowEnd: 1100, window: 30, armedAt: 0, expiry: 1220 })).toBe(false);
  });
  it("leverage in plain numbers", () => {
    expect(leverageOf(500_000, 400_000, 1_000_000)).toEqual({ yes: 5, no: 1 });
    expect(leverageOf(500_000, 0, 550_000)).toEqual({ yes: 1, no: 10 });
  });
});
