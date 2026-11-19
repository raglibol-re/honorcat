import { describe, expect, it } from "vitest";
import { perpWillRoll } from "../src/perps";

describe("perp roll", () => {
  it("rolls only after a division with nobody leaving and both renewing; never after a settled or returned rope", () => {
    expect(perpWillRoll("Divided", { leaving: false, renewA: true, renewB: true })).toBe(true);
    expect(perpWillRoll("Divided", { leaving: true, renewA: true, renewB: true })).toBe(false);
    expect(perpWillRoll("Divided", { leaving: false, renewA: false, renewB: true })).toBe(false);
    expect(perpWillRoll("Settled", { leaving: false, renewA: true, renewB: true })).toBe(false);
    expect(perpWillRoll("Expired", { leaving: false, renewA: true, renewB: true })).toBe(false);
  });
});
