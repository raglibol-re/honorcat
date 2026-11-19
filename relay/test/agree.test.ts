import { describe, expect, it } from "vitest";
import { averagesAgree, readyToPropose } from "../src/pots";

const a = (ppm: number, valid = true) => ({ price_ppm: String(ppm), valid });

describe("two samplers that agree settle the price without waiting for the third", () => {
  it("agrees within half a point, with the same verdict", () => {
    expect(averagesAgree([a(455_000), a(459_000)], 2)).toBe(true);
    expect(averagesAgree([a(455_000), a(460_000)], 2)).toBe(true); // exactly half a point
    expect(averagesAgree([a(0, false), a(0, false)], 2)).toBe(true); // both say: no valid price
  });
  it("waits when they disagree, or when too few reported", () => {
    expect(averagesAgree([a(455_000), a(460_100)], 2)).toBe(false);
    expect(averagesAgree([a(455_000), a(455_000, false)], 2)).toBe(false);
    expect(averagesAgree([a(455_000)], 2)).toBe(false);
  });
});

describe("a running third sampler is waited for, so three run means the median of three", () => {
  const base = { samplers: 3, threshold: 2, agree: true };
  it("waits for a third that checked in recently, until its time is up", () => {
    expect(readyToPropose({ ...base, reported: 2, ended: false, othersAlive: 1 })).toBe(false);
    expect(readyToPropose({ ...base, reported: 2, ended: true, othersAlive: 1 })).toBe(true);
    expect(readyToPropose({ ...base, reported: 3, ended: false, othersAlive: 0 })).toBe(true);
  });
  it("does not wait when the third is not running", () => {
    expect(readyToPropose({ ...base, reported: 2, ended: false, othersAlive: 0 })).toBe(true);
    expect(readyToPropose({ ...base, reported: 2, ended: false, othersAlive: 0, agree: false })).toBe(false);
    expect(readyToPropose({ ...base, reported: 1, ended: true, othersAlive: 0 })).toBe(false);
  });
});
