import { describe, expect, it } from "vitest";
import { GROUP_BASE, chainPotId, groupDbId, isGroupDbId, isRopeDbId } from "../src/ropes";
import { windowOfBatch } from "../src/groups";

describe("group pots in the relay", () => {
  it("live at 9e9 + id, apart from ropes", () => {
    expect(groupDbId(7n)).toBe("9000000007");
    expect(isGroupDbId("9000000007")).toBe(true);
    expect(isRopeDbId("9000000007")).toBe(false);
    expect(isRopeDbId("2000000005")).toBe(true);
    expect(chainPotId(GROUP_BASE + 7n)).toBe(7n);
  });
  it("price batch k over the window after it stops collecting (the contract's windowOf)", () => {
    const d = { createdAt: 1_000, window: 30 };
    expect(windowOfBatch(d, 0n)).toEqual({ start: 1_060, end: 1_090 });
    expect(windowOfBatch(d, 4n)).toEqual({ start: 1_300, end: 1_330 });
  });
});
