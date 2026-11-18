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
  it("keeps anything else, tidied, without the relay's call name", () => {
    expect(plainMessage("something odd")).toBe("That did not go through: Something odd. If no transaction is shown, nothing was sent.");
    expect(plainMessage("create failed: execution reverted")).toBe("That did not go through: Execution reverted. If no transaction is shown, nothing was sent.");
    expect(plainMessage("")).toMatch(/nothing was sent/);
  });
  it("tells a closed or timed-out passkey prompt and a wrong address apart from a cancel", () => {
    expect(plainMessage("NotAllowedError: The operation either timed out or was not allowed.")).toMatch(/closed or timed out/);
    expect(plainMessage("SecurityError: The relying party ID is not a registrable domain suffix")).toMatch(/another web address/);
    expect(plainMessage("User rejected the request.")).toMatch(/You cancelled/);
  });
  it("explains the perp contract's refusals", () => {
    expect(plainMessage("execution reverted: TooLittle()")).toMatch(/at least one life/);
    expect(plainMessage("WrongPhase()")).toMatch(/moved on/);
  });
});
