import { describe, expect, it } from "vitest";
import { averagesAgree } from "../src/pots";

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
