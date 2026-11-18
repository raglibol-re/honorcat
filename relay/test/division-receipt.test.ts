import { describe, expect, it } from "vitest";
import { divisionReceipts, fractionWords } from "../../web/src/lib/divisionReceipt";
import type { ReceiptEvent } from "../../web/src/lib/receipts";

const ev = (name: string, args: Record<string, string>, tx: string, at: number): ReceiptEvent => ({ name, args, tx, at });

/** A v1 pot of $9.00 joined at 60%, then YES takes a ninth off at 70%, then NO leaves the rest at 55%. */
const v1: ReceiptEvent[] = [
  ev("PotCreated", { notional: "9000000", side: "0" }, "0x1", 100),
  ev("Joined", { depYes: "5400000", depNo: "3600000" }, "0x2", 140),
  ev("ExitRequested", { side: "0", notional: "1000000" }, "0x3", 200),
  // 1.00 at 70%: YES's part 0.70, NO's 0.30; fee 1% of 1.00 = 0.01
  ev("PotDivided", { exitSide: "0", notional: "1000000", price: "700000", paidYes: "690000", paidNo: "310000", fee: "10000" }, "0x4", 238),
  ev("ExitRequested", { side: "1", notional: "8000000" }, "0x5", 300),
  // 8.00 at 55%: YES 4.40, NO 3.60; fee 0.08 from NO
  ev("PotDivided", { exitSide: "1", notional: "8000000", price: "550000", paidYes: "4480000", paidNo: "3520000", fee: "80000" }, "0x6", 340),
];

describe("exit receipts", () => {
  it("both receipts add up to the slice, and the pot left is the old pot minus the slice", () => {
    const rs = divisionReceipts(v1);
    expect(rs).toHaveLength(2);
    for (const r of rs) {
      expect(r.received[0] + r.received[1]).toBe(r.slice);
      expect(r.part[0] + r.part[1]).toBe(r.slice);
      expect(r.potAfter).toBe(r.potBefore - r.slice);
      // the leaver: its part minus the treat; the other side: its part plus the treat
      expect(r.part[r.exitSide] - r.treat).toBe(r.received[r.exitSide]);
      expect(r.part[1 - r.exitSide]! + r.treat).toBe(r.received[1 - r.exitSide]);
    }
    expect(rs[0]).toMatchObject({ exitSide: 0, slice: 1_000_000n, potBefore: 9_000_000n, potAfter: 8_000_000n, full: false, fraction: "one ninth", part: [700_000n, 300_000n], treat: 10_000n, livesLeft: 8 });
    expect(rs[1]).toMatchObject({ exitSide: 1, potBefore: 8_000_000n, potAfter: 0n, full: true, livesLeft: 0 });
  });

  it("says the real fraction", () => {
    expect(fractionWords(1n, 9n)).toBe("one ninth");
    expect(fractionWords(3n, 9n)).toBe("a third");
    expect(fractionWords(1n, 2n)).toBe("half");
    expect(fractionWords(42n, 100n)).toBe("42%");
  });

  it("a handshake is not an exit receipt, and v2 pots count lives and extra lives", () => {
    const hs = divisionReceipts([
      ...v1.slice(0, 2),
      ev("Handshake", { price: "600000", notional: "9000000" }, "0x9", 200),
      ev("PotDivided", { exitSide: "0", notional: "9000000", price: "600000", paidYes: "5400000", paidNo: "3600000", fee: "0" }, "0x9", 200),
    ]);
    expect(hs).toEqual([]);
    const v2 = divisionReceipts([
      ev("PotCreated", { size: "100", distYes: "50000" }, "0xa", 100),
      ev("Joined", { depYes: "50000", depNo: "50000" }, "0xb", 130),
      ev("ExtraLife", { side: "0", paid: "50000" }, "0xc", 150),
      ev("KnockOutTriggered", { knockedSide: "0", priceYes: "390000" }, "0xd", 200),
      ev("PotDivided", { reason: "1", size: "100", price: "380000", paidYes: "0", paidNo: "150000", fee: "0" }, "0xe", 240),
    ]);
    expect(v2[0]).toMatchObject({ exitSide: 0, slice: 150_000n, potBefore: 150_000n, potAfter: 0n, full: true });
  });
});
