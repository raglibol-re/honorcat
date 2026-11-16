import { describe, expect, it } from "vitest";
import { rowsFromEvent, yesMeansOf } from "../src/catalog";

describe("market names", () => {
  it("reads what YES means from the contract's own rule", () => {
    expect(yesMeansOf("If Boston wins the Pro Basketball game between Boston and Orlando originally scheduled for November 16, 2026 at 7:00 PM ET, this market will resolve to Yes. Otherwise, it will resolve to No.")).toBe(
      "Boston wins the Pro Basketball game between Boston and Orlando originally scheduled for November 16, 2026 at 7:00 PM ET",
    );
    expect(yesMeansOf("No rule here")).toBeNull();
  });
  it("adds league, both teams and the start to a catalogue row", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const [r] = rowsFromEvent(
      {
        ticker: "NBA-2611170000-ORL-BOS-M",
        title: "Orlando vs Boston",
        category: "Sports",
        subcategory: { name: "Pro Basketball" },
        status: "active",
        startTime: "2026-11-17T00:00:00.000Z",
        expiryDate: "2026-11-18T12:00:00.000Z",
        participants: [
          { name: "Boston Celtics", side: "home" },
          { name: "Orlando Magic", side: "away" },
        ],
        contracts: [
          {
            ticker: "BOS",
            label: "Boston",
            status: "active",
            instrumentSymbol: "GEMI-NBA-2611170000-ORL-BOS-M-BOS",
            description: { content: [{ content: [{ value: "If Boston wins the game, this market will resolve to Yes." }] }] },
          },
        ],
      },
      now,
    );
    expect(r).toMatchObject({ league: "NBA", teams: "Orlando Magic at Boston Celtics", startMs: Date.parse("2026-11-17T00:00:00Z"), yesMeans: "Boston wins the game" });
  });
});
