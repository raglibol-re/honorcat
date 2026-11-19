import { describe, expect, it } from "vitest";
import { cents, receiptsOf, took } from "../../web/src/lib/receipts";

const name = (s: number) => (s === 0 ? "Mochi" : "Tofu");
const says = (s: number) => (s === 0 ? "Boston beats Orlando" : "Boston does not beat Orlando");
const exit = [
  { name: "ExitRequested", args: { side: "0" }, tx: "0x1", at: 1000 },
  { name: "PotDivided", args: { exitSide: "0", price: "745000", paidYes: "7400000", paidNo: "2600000", fee: "100000" }, tx: "0x2", at: 1038 },
];

describe("Arc in plain words", () => {
  it("fees in cents", () => {
    expect(cents("5755")).toBe("0.6¢");
    expect(cents("600")).toBe("0.06¢");
    expect(cents("12000")).toBe("1.2¢");
    expect(cents("50000")).toBe("$0.05");
    expect(cents(null)).toBeNull();
  });
  it("a receipt sentence for the one who left, the one who stayed, and a visitor", () => {
    expect(receiptsOf(exit, 0, name, says)[0]!.text).toBe("You left at 74.5% and received $7.40.");
    expect(receiptsOf(exit, 1, name, says)[0]!.text).toBe("Mochi left at 74.5%; you received $2.60, including a $0.100 treat.");
    expect(receiptsOf(exit, null, name, says)[0]!.text).toBe("Mochi left at 74.5% and received $7.40; Tofu received $2.60.");
  });
  it("how long the payout took", () => {
    expect(receiptsOf(exit, 0, name, says)[0]!.tookS).toBe(38);
    expect(took(1000, 1038)).toBe("38 seconds");
    expect(took(1000, 1300)).toBe("5 minutes");
  });
  it("settlement and handshake", () => {
    const settled = [{ name: "PotSettled", args: { outcome: "1", paidYes: "10000000", paidNo: "0" }, tx: "0x3", at: 2000 }];
    expect(receiptsOf(settled, 0, name, says)[0]!.text).toBe("Gemini's result: Boston beats Orlando. You received $10.00.");
    const hs = [{ name: "Handshake", args: { price: "700000", notional: "10000000" }, tx: "0x4", at: 3000 }];
    expect(receiptsOf(hs, 1, name, says)[0]!.text).toBe("You shook hands at 70.0% and received $3.00, with no fee.");
  });
});

describe("what the viewer received", () => {
  it("marks the viewer's own amount on each receipt", () => {
    expect(receiptsOf(exit, 1, name, says)[0]!.mine).toBe(2_600_000n);
    expect(receiptsOf(exit, null, name, says)[0]!.mine).toBeUndefined();
  });
});
