import { describe, expect, it } from "vitest";
import { adviceFree, exitOptions, levelOptions, numbersFrom, readWish } from "../../web/src/lib/helper";

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

describe("wishes in plain words", () => {
  it("protect half my stake -> a net at half of today's chance", () => {
    expect(readWish("protect half my stake", 0.6, 10)).toMatchObject({ kind: "net", percent: 30 });
  });
  it("take my share off at $8.50 -> a bowl at 85%", () => {
    expect(readWish("take my share off at $8.50", 0.6, 10)).toMatchObject({ kind: "bowl", percent: 85 });
  });
  it("percent wishes", () => {
    expect(readWish("if it drops below 40%", 0.6, 10)).toMatchObject({ kind: "net", percent: 40 });
    expect(readWish("take profit at 90%", 0.6, 10)).toMatchObject({ kind: "bowl", percent: 90 });
  });
  it("refuses what cannot work, and never advises", () => {
    expect(readWish("take my share off at $5", 0.6, 10).kind).toBe("none");
    expect(readWish("should I leave?", 0.6, 10).kind).toBe("none");
    for (const w of ["protect half my stake", "take profit at 90%"]) expect(adviceFree(readWish(w, 0.6, 10).why)).toBe(true);
  });
  it("net and bowl sentences inform without advising", () => {
    for (const l of levelOptions({ own: 0.6, shareNow: "$6.00", net: 30, bowl: null })) expect(adviceFree(l)).toBe(true);
  });
});
