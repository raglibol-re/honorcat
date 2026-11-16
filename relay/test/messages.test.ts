import { describe, expect, it } from "vitest";
import { plainMessage } from "../../web/src/lib/messages";

describe("plain messages", () => {
  it("says what happened and what happens next", () => {
    expect(plainMessage("This market's order book allows pots up to $3.00 right now")).toMatch(/too thin.*Put in less/);
    expect(plainMessage('execution reverted: Cooldown()')).toMatch(/ask again in two minutes/);
    expect(plainMessage("TooLate")).toMatch(/final result decides/);
    expect(plainMessage("Passkey creation was cancelled")).toMatch(/nothing was sent/);
    expect(plainMessage("The transaction failed on Arc. Nothing was taken except the network fee.")).toMatch(/failed on Arc/);
    expect(plainMessage("Could not add test money: pool empty")).toMatch(/^HonorCat's test money/);
  });
  it("keeps anything else, tidied", () => {
    expect(plainMessage("something odd")).toBe("Something odd.");
    expect(plainMessage("")).toMatch(/nothing was sent/);
  });
});
