import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "../../web/src/lib/amount";
import { splitPot } from "../../web/src/lib/shares";

const shown = (base: bigint) => formatAmount(Number(base) / 1e6);
const mills = (s: string) => Math.round(parseAmount(s) * 1000);

describe("the two shares always add up to the pot", () => {
  it("pot 4's case: $1.00 at 75.55% is $0.756 and $0.244", () => {
    const s = splitPot(1_000_000n, 0.7555);
    expect(s.yes + s.no).toBe(1_000_000n);
    expect([shown(s.yes), shown(s.no), shown(1_000_000n)]).toEqual(["$0.756", "$0.244", "$1.00"]);
  });
  it("pot 19's case: deposits of $0.675 and $0.325 on a $1.00 pot are written so they add up", () => {
    expect([shown(675_000n), shown(325_000n)]).toEqual(["$0.675", "$0.325"]);
  });
  it("for any pot (whole tenths of a cent) and price, the written shares add up to the written pot", () => {
    for (let i = 0; i < 5000; i++) {
      const n = BigInt(Math.floor(Math.random() * 25_000) + 1) * 1_000n;
      const s = splitPot(n, Math.random());
      expect(s.yes + s.no).toBe(n);
      expect(s.yes >= 0n && s.no >= 0n).toBe(true);
      expect(Number(s.yes % 1_000n)).toBe(0);
      expect(mills(shown(s.yes)) + mills(shown(s.no))).toBe(mills(shown(n)));
    }
  });
  it("writes amounts by one rule", () => {
    expect(formatAmount(7.4)).toBe("$7.40");
    expect(formatAmount(7.405)).toBe("$7.405");
    expect(formatAmount(0.5)).toBe("$0.500");
    expect(formatAmount(0.02)).toBe("$0.020");
    expect(formatAmount(0.0004)).toBe("under 0.1¢");
    expect(formatAmount(0)).toBe("$0.00");
    expect(formatAmount(-0.25)).toBe("-$0.250");
  });
  it("edges", () => {
    expect(splitPot(1_000_000n, 0)).toEqual({ yes: 0n, no: 1_000_000n });
    expect(splitPot(1_000_000n, 1)).toEqual({ yes: 1_000_000n, no: 0n });
    expect(splitPot(500n, 0.99)).toEqual({ yes: 0n, no: 500n }); // half a tenth of a cent rounds to nothing
  });
});
