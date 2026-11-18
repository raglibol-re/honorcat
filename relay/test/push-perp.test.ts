import { describe, expect, it } from "vitest";
import { perpMessage } from "../src/push";

describe("perp notifications", () => {
  const d = (phase: number, ropes: number, livesA = "3", livesB = "2") => ({ phase, ropes, livesA, livesB });
  it("says when someone joined, when a rope ended, and when the perp ended", () => {
    expect(perpMessage("7", d(1, 0), d(2, 0))?.body).toMatch(/Someone took the other side/);
    expect(perpMessage("7", d(4, 1), d(4, 2, "3", "1"))?.body).toBe("Rope 1 ended and rope 2 started. Lives left: 3 and 1.");
    expect(perpMessage("7", d(4, 3), d(5, 3))?.body).toMatch(/ended after 3 ropes/);
  });
  it("stays quiet otherwise (first sight, the first rope starting, no change)", () => {
    expect(perpMessage("7", null, d(4, 1))).toBeNull();
    expect(perpMessage("7", d(3, 0), d(4, 1))).toBeNull();
    expect(perpMessage("7", d(4, 2), d(4, 2))).toBeNull();
  });
});
