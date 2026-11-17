import { describe, expect, it } from "vitest";
import { inEuros, money, rateText, setHome } from "../../web/src/lib/currency";

describe("home currency", () => {
  it("dollars by default", () => {
    expect(money("7400000")).toBe("$7.40");
    expect(inEuros()).toBe(false);
  });
  it("stays in dollars until a euro rate is known", () => {
    setHome("EURC");
    expect(inEuros()).toBe(false);
    expect(money(2_500_000n)).toBe("$2.50");
    setHome("USDC");
  });
  it("states the rate plainly", () => {
    expect(rateText({ eurcPerUsdc: 0.90887, usdcUsd: 1, eurcUsd: 1.1, fetchedAt: 0, source: "" })).toBe("1 USDC = 0.909 EURC");
  });
});
