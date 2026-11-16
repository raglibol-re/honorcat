import { describe, expect, it } from "vitest";
import { honorLabels } from "../../web/src/lib/honor";

const z = { pots: 0, heldToEnd: 0, exits: 0, exitsByNet: 0, exitsByBowl: 0, handshakes: 0, tookOver: 0, takenOver: 0 };
describe("honor record labels", () => {
  it("come only from the facts", () => {
    expect(honorLabels(z).map((l) => l.label)).toEqual(["New here"]);
    expect(honorLabels({ ...z, pots: 5, heldToEnd: 4 }).map((l) => l.label)).toEqual(["Holds to the end"]);
    expect(honorLabels({ ...z, pots: 3, handshakes: 1, exits: 2 }).map((l) => l.label)).toEqual(["Often splits by handshake", "Often leaves early"]);
    expect(honorLabels({ ...z, pots: 4, heldToEnd: 4 })[0]!.because).toBe("held to Gemini's result in 4 of 4 pots");
  });
});
