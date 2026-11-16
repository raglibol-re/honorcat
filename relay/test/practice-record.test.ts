import { describe, expect, it } from "vitest";
import { memoryDb } from "../src/db";
import { honorRecord, listPotsHc } from "../src/pots";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

async function seed() {
  const db = await memoryDb();
  let i = 0;
  const ev = (name: string, pot: number, args: Record<string, unknown>) =>
    db.query(
      "INSERT INTO pot_events (tx_hash, log_index, block_number, block_time, event_name, pot_id, args, source) VALUES ($1,$2,$3,$4,$5,$6,$7,'rpc')",
      [`0x${(++i).toString(16).padStart(64, "0")}`, 0, i, 1_700_000_000 + i, name, pot, JSON.stringify(args)],
    );
  // Pot 1: a real pot A held to the end. Pot 2: a practice pot A left.
  for (const pot of [1, 2]) {
    await ev("Transfer", pot, { from: "0x0", to: A, tokenId: String(pot * 2) });
    await ev("Transfer", pot, { from: "0x0", to: B, tokenId: String(pot * 2 + 1) });
    await db.query(
      "INSERT INTO pots (pot_id, state, data, condition_id, yes_owner, no_owner) VALUES ($1, $2, '{\"notional\":\"1000000\",\"closeTime\":\"9999999999\"}', $3, $4, $5)",
      [pot, pot === 1 ? 6 : 5, `0x${"0".repeat(63)}${pot}`, A, B],
    );
  }
  await ev("PotSettled", 1, { outcome: "1" });
  await ev("ExitRequested", 2, { side: "0" });
  await ev("PotDivided", 2, { exitSide: "0", price: "500000" });
  await db.query("INSERT INTO practice_pots (pot_id) VALUES (2)");
  return db;
}

describe("practice pots stay out of the honor record and public lists", () => {
  it("counts only the real pot in the honor record", async () => {
    const r = await honorRecord(await seed(), A);
    expect(r.pots).toBe(1);
    expect(r.heldToEnd).toBe(1);
    expect(r.exits).toBe(0);
  });
  it("hides practice pots from public lists but shows them to their owner, marked", async () => {
    const db = await seed();
    expect((await listPotsHc(db)).map((p) => p.potId)).toEqual(["1"]);
    const mine = await listPotsHc(db, { owner: A });
    expect(mine.map((p) => [p.potId, p.practice])).toEqual([["2", true], ["1", false]]);
  });
});
