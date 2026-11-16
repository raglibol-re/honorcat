import { describe, expect, it } from "vitest";
import { splitPot } from "../../web/src/lib/shares";

describe("the two shares always add up to the pot", () => {
  it("pot 4's case: $1.00 at 75.5% is $0.76 and $0.24, never $0.75 and $0.26", () => {
    const s = splitPot(1_000_000n, 0.755);
    expect(s.yes + s.no).toBe(1_000_000n);
    expect([s.yes, s.no]).toEqual([760_000n, 240_000n]);
  });
  it("for any pot and price", () => {
    for (let i = 0; i < 2000; i++) {
      const n = BigInt(Math.floor(Math.random() * 25_000_000) + 1);
      const p = Math.random();
      const s = splitPot(n, p);
      expect(s.yes + s.no).toBe(n);
      expect(s.yes >= 0n && s.no >= 0n).toBe(true);
      if (s.yes !== n) expect(Number(s.yes % 10_000n)).toBe(0); // the rounded side is whole cents
    }
  });
  it("edges", () => {
    expect(splitPot(1_000_000n, 0)).toEqual({ yes: 0n, no: 1_000_000n });
    expect(splitPot(1_000_000n, 1)).toEqual({ yes: 1_000_000n, no: 0n });
    expect(splitPot(5_000n, 0.99)).toEqual({ yes: 0n, no: 5_000n }); // half a cent rounds to nothing
  });
});
