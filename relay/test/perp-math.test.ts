import { describe, expect, it } from "vitest";
import { FIRST_TOLERANCE, lifeFits, perpFit, perpLabel, perpProblem, perpRope, perpSteps, stakeFor, times, treatOf, livesOf } from "../../web/src/lib/perpMath";

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
    expect(perpLabel(100_000, 6, 4)).toBe("Perp, posts 10 points either side, 6× and 4×");
    expect(times(7.333)).toBe("7.3×");
    const now = Date.UTC(2026, 10, 18, 12);
    expect(lifeFits(3600, now + 3 * 3600_000, now)).toBe(true);
    expect(lifeFits(3600, now + 2.5 * 3600_000, now)).toBe(false);
  });

  it("says per market whether a perp works and the highest leverage", () => {
    const now = Date.UTC(2026, 10, 19, 12);
    const day = 24 * 3600_000;
    expect(perpFit({ mid: 0.5, spreadPpm: 10_000, crypto: false, closeMs: now + day }, now)).toEqual({ ok: true, maxLeverage: 4 });
    expect(perpFit({ mid: 0.455, spreadPpm: 10_000, crypto: true, closeMs: now + day }, now)).toMatchObject({ ok: true });
    expect(perpFit({ mid: 0.97, spreadPpm: 10_000, crypto: true, closeMs: now + day }, now)).toEqual({ ok: false, reason: "Price too close to 100 for a perp: a post must stay 2 points inside 0 and 100, and this market allows at most 10×" });
    expect(perpFit({ mid: 0.5, spreadPpm: 10_000, crypto: true, closeMs: now + 2 * 3600_000 }, now)).toEqual({ ok: false, reason: "Closes too soon for a perp" });
    expect(perpFit({ mid: null, spreadPpm: 10_000, crypto: true, closeMs: now + day }, now)).toMatchObject({ ok: false });
  });
});

describe("lives follow one rule for both players", () => {
  it("whole stakes in the free balance, plus the stake in the running rope", () => {
    // perp 13: free $0.0846 and $0.0754 at a $0.01 stake, a rope running
    expect(livesOf(84_635n, 10_000n, true)).toBe(9);
    expect(livesOf(75_390n, 10_000n, true)).toBe(8);
    expect(livesOf(75_390n, 10_000n, false)).toBe(7);
    expect(livesOf(9_999n, 10_000n, false)).toBe(0);
    for (let i = 0; i < 500; i++) {
      const stake = BigInt(1 + Math.floor(Math.random() * 1_000_000));
      const free = BigInt(Math.floor(Math.random() * 20_000_000));
      expect(livesOf(free, stake, true)).toBe(Number(free / stake) + 1);
    }
  });
});

describe("the market picker says which rule stops a perp", () => {
  const later = Date.now() + 3 * 86_400_000;
  it("no price", () => {
    expect(perpFit({ mid: null, spreadPpm: 10_000, crypto: false, closeMs: later })).toEqual({ ok: false, reason: "No price right now" });
  });
  it("closes too soon", () => {
    expect(perpFit({ mid: 0.5, spreadPpm: 10_000, crypto: false, closeMs: Date.now() + 3600_000 })).toEqual({ ok: false, reason: "Closes too soon for a perp" });
  });
  it("Houston and Duke: a 1-cent spread at 84% is too close to 100 for the leverage this market allows, not a wide spread", () => {
    const r = perpFit({ mid: 0.84, spreadPpm: 10_000, crypto: false, closeMs: later });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/too close to 100/);
      expect(r.reason).toMatch(/at most 5×/);
    }
  });
  it("a really wide spread is reported as the spread", () => {
    const r = perpFit({ mid: 0.5, spreadPpm: 300_000, crypto: false, closeMs: later });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Spread too wide/);
  });
  it("an even, tight market works", () => {
    expect(perpFit({ mid: 0.5, spreadPpm: 10_000, crypto: false, closeMs: later }).ok).toBe(true);
  });
});
