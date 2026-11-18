import { describe, expect, it } from "vitest";
import { countdown, expiryChoices, leverageSteps, ropeFor, ropeProblem, ropeShares, ropeWords } from "../../web/src/lib/rope";

describe("short ropes in the interface (same rules as HonorCatRopes)", () => {
  it("a 5x YES rope at 50: post at 40, the stake buys 10 points per contract", () => {
    const c = ropeFor(0, 500_000, 1_000_000n, 5); // $1
    expect(c.distance).toBe(100_000);
    expect(c.lower).toBe(400_000);
    expect(c.upper).toBe(1_000_000);
    expect(c.size).toBe(1_000n);
    expect(c.mine).toBe(1_000_000n);
    expect(c.theirs).toBe(5_000_000n);
    expect(c.pot).toBe(6_000_000n);
  });
  it("shares clamp at the posts and always add up to the pot", () => {
    for (const p of [0, 350_000, 400_000, 412_345, 777_777, 1_000_000]) {
      const s = ropeShares(1_000n, p, 400_000, 1_000_000);
      expect(s.yes + s.no).toBe(s.total);
      expect(s.yes >= 0n && s.no >= 0n).toBe(true);
    }
    expect(ropeShares(1_000n, 0, 400_000, 1_000_000).yes).toBe(0n);
  });
  it("says it in plain words", () => {
    const w = ropeWords(0, ropeFor(0, 500_000, 1_000_000n, 5), "BTC above 100k");
    expect(w.doubles).toMatch(/^A 10-point move doubles your stake/);
    expect(w.loseAll).toBe("You can lose your whole stake if the price falls to 40.");
    const n = ropeWords(1, ropeFor(1, 500_000, 1_000_000n, 2), "x");
    expect(n.loseAll).toBe("You can lose your whole stake if the price rises to 75.");
  });
  it("respects the minimum distance and the maximum leverage", () => {
    const o = { side: 0 as const, center: 500_000, tolerance: 0, spread: 20_000, crypto: false };
    expect(leverageSteps(o)).toEqual([1, 2, 3, 5]);
    expect(leverageSteps({ ...o, crypto: true })).toEqual([1, 2, 3, 5, 10]);
    expect(ropeProblem(ropeFor(0, 500_000, 1n, 10), { ...o, crypto: true, spread: 30_000 })).toMatch(/at least 6 points/);
  });
  it("offers expiries inside the contract's limits", () => {
    const now = 1_000_000;
    const ch = expiryChoices(now, now + 10 * 3600);
    expect(ch.map((c) => c.label)).toEqual(["1 hour", "6 hours", "until 2 hours before trading closes"]);
    expect(ch.every((c) => c.at <= now + 8 * 3600 && c.at >= now + 600)).toBe(true);
    expect(expiryChoices(now, now + 2 * 3600 + 300)).toEqual([]);
  });
  it("counts down", () => {
    expect(countdown(1000 + 2 * 3600 + 300, 1000)).toBe("2 h 05 min");
    expect(countdown(1000 + 250, 1000)).toBe("4 min 10 s");
    expect(countdown(1000 + 3 * 86_400 + 4 * 3600, 1000)).toBe("3 days 4 h");
  });
});
