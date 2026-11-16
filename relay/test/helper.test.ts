import { describe, expect, it } from "vitest";
import { adviceFree, exitOptions, numbersFrom } from "../../web/src/lib/helper";

const input = { leaveAbout: "$0.49", fee: "$0.01", pot: "$0.65", mine: "Boston beats Orlando", other: "Practice cat", chance: "76.5%" };

describe("the helper cat's words", () => {
  it("uses only the numbers our code supplied", () => {
    const lines = exitOptions(input);
    for (const l of lines) expect(numbersFrom(l, Object.values(input).concat(["30"]))).toBe(true);
    expect(numbersFrom("You would get $0.70 now", Object.values(input))).toBe(false);
  });
  it("informs and never advises", () => {
    for (const l of exitOptions(input)) expect(adviceFree(l)).toBe(true);
    for (const bad of ["You should leave now.", "I recommend staying.", "Better to take the NO side.", "I'd hold."]) expect(adviceFree(bad)).toBe(false);
  });
  it("names a partial exit as one", () => {
    expect(exitOptions({ ...input, part: "$0.07 of the pot" })[0]).toMatch(/rest of the pot stays live/);
  });
});
