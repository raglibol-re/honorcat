import { describe, expect, it } from "vitest";
import { sidesOf } from "../../web/src/lib/statement";

describe("markets as a statement and its opposite", () => {
  it("a winner", () => {
    const s = sidesOf({ eventTitle: "Chicago vs Cleveland", label: "Cleveland", teams: "Chicago Bulls at Cleveland Cavaliers" });
    expect(s.yes).toBe("Cleveland beats Chicago");
    expect(s.no).toBe("Cleveland does not beat Chicago");
  });
  it("abbreviated teams get their full name", () => {
    const s = sidesOf({ eventTitle: "Los Angeles C vs Baltimore", label: "Baltimore", teams: "Los Angeles Chargers at Baltimore Ravens" });
    expect(s.yes).toBe("Baltimore beats Los Angeles Chargers");
    expect(sidesOf({ eventTitle: "Montreal vs New York R", label: "New York R", teams: "Montreal Canadiens at New York Rangers" }).yes).toBe("New York Rangers beats Montreal");
  });
  it("a point spread", () => {
    const s = sidesOf({ eventTitle: "Miami (OH) vs Kent State: Point Spread", label: "Miami (OH) wins by more than 9.5 points" });
    expect(s.yes).toBe("Miami (OH) wins by more than 9.5 points");
    expect(s.no).toBe("Miami (OH) does not win by more than 9.5 points");
  });
  it("a draw", () => {
    expect(sidesOf({ eventTitle: "Fulham vs Man City", label: "Tie" }).yes).toBe("Fulham and Man City draw");
  });
  it("names with spaces", () => {
    expect(sidesOf({ eventTitle: "Fulham vs Man City", label: "Man City" }).no).toBe("Man City does not beat Fulham");
  });
  it("crypto up", () => {
    const s = sidesOf({ eventTitle: "BTC price today at 11:45am EST", label: "Up", yesMeans: "the price of Bitcoin (BTC) is greater than or equal to the price specified in the title on November 16, 2026" });
    expect(s.yes).toBe("Bitcoin (BTC) ends at or above its reference price");
    expect(s.no).toBe("Bitcoin (BTC) ends below its reference price");
  });
  it("anything else", () => {
    const s = sidesOf({ eventTitle: "Chicago Total Wins", label: "11+ wins" });
    expect(s.yes).toBe("Chicago Total Wins: 11+ wins");
    expect(s.no).toBe("Chicago Total Wins: not 11+ wins");
  });
});
