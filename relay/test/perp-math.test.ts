import { describe, expect, it } from "vitest";
import { FIRST_TOLERANCE, lifeFits, perpLabel, perpProblem, perpRope, perpSteps, stakeFor, times, treatOf } from "../../web/src/lib/perpMath";

describe("perp rope", () => {
  it("d is the creator side's price over its leverage, rounded up to a tick; the other side's leverage follows", () => {
    const r = perpRope(0, 450_000, 6);
    expect(r.d).toBe(75_000);
    expect(r.levMine).toBe(6);
    expect(r.levTheirs).toBeCloseTo(7.33, 2);
    expect([r.lower, r.upper]).toEqual([375_000, 525_000]);
    // a NO creator at YES 45%: its own price is 55%
    const n = perpRope(1, 450_000, 5);
    expect(n.d).toBe(110_000);
    expect(n.levTheirs).toBeCloseTo(450_000 / 110_000, 6);
    // rounding up keeps the leverage at or below the step
    expect(perpRope(0, 333_333, 7).d % 100).toBe(0);
    expect(perpRope(0, 333_333, 7).levMine).toBeLessThanOrEqual(7);
  });

  it("refuses what HonorCatRopes refuses: distance, leverage over the whole band, the 2-point post margin", () => {
    const zec = { spread: 10_000, crypto: true };
    // the e2e rope: ZEC 45.5%, 6 points, band 3 points
    expect(perpProblem({ d: 60_000 }, { yesPpm: 455_000, tol: 30_000, ...zec })).toBeNull();
    // 5 points: NO leverage at the band's low end is (100 − 43.5) / 5 = 11.3 > 10
    expect(perpProblem({ d: 50_000 }, { yesPpm: 455_000, tol: 20_000, ...zec })).toMatch(/At most 10×/);
    // below the minimum distance (twice a 4-point spread)
    expect(perpProblem({ d: 60_000 }, { yesPpm: 500_000, tol: 0, spread: 40_000, crypto: true })).toMatch(/at least 8 points/);
    // the lower post exactly 2 points above 0 is allowed; one tick closer is not
    expect(perpProblem({ d: 100_000 }, { yesPpm: 120_000, tol: 0, spread: 0, crypto: true })).toBeNull();
    expect(perpProblem({ d: 100_000 }, { yesPpm: 119_900, tol: 0, spread: 0, crypto: true })).toMatch(/too close to 0 or 100/);
    expect(perpProblem({ d: 100_000 }, { yesPpm: 880_000, tol: 0, spread: 0, crypto: true })).toBeNull();
    expect(perpProblem({ d: 100_000 }, { yesPpm: 880_100, tol: 0, spread: 0, crypto: true })).toMatch(/too close to 0 or 100/);
  });

  it("only offers steps that pass at every price in the first rope's band", () => {
    for (const yes of [150_000, 300_000, 500_000, 700_000, 900_000])
      for (const crypto of [true, false])
        for (const side of [0, 1] as const)
          for (const r of perpSteps(side, yes, { spread: 10_000, crypto })) {
            const max = crypto ? 10 : 5;
            for (const at of [yes - FIRST_TOLERANCE, yes, yes + FIRST_TOLERANCE]) {
              expect(at / r.d).toBeLessThanOrEqual(max);
              expect((1_000_000 - at) / r.d).toBeLessThanOrEqual(max);
              expect(at - r.d).toBeGreaterThanOrEqual(20_000);
              expect(at + r.d).toBeLessThanOrEqual(980_000);
            }
          }
    // a game at 50%: 5× at most, and 5× itself fails at the band's edge, so 2×, 3×, 4×
    expect(perpSteps(0, 500_000, { spread: 10_000, crypto: false }).map((r) => r.leverage)).toEqual([2, 3, 4]);
  });

  it("stake, treat, labels and rope life", () => {
    expect(stakeFor(60_000, 6_000n)).toEqual({ size: 10n, stake: 6_000n });
    expect(stakeFor(75_000, 1_000_000n)).toEqual({ size: 1333n, stake: 999_750n });
    expect(treatOf(6_000n)).toBe(15n);
    expect(perpLabel(100_000, 6, 4)).toBe("Perp, rope 10 points, 6× and 4×");
    expect(times(7.333)).toBe("7.3×");
    const now = Date.UTC(2026, 10, 18, 12);
    expect(lifeFits(3600, now + 3 * 3600_000, now)).toBe(true);
    expect(lifeFits(3600, now + 2.5 * 3600_000, now)).toBe(false);
  });
});
