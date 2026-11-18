import { describe, expect, it } from "vitest";
import { memoryDb } from "../src/db";
import { cosmeticsOf, progressOf } from "../src/cosmetics";
import { leaderboard, treatsOf } from "../src/treats";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const C = "0x00000000000000000000000000000000000000cc";
const Z = "0x0000000000000000000000000000000000000000";

async function seeded() {
  const db = await memoryDb();
  let n = 0;
  const ev = (name: string, pot: string | null, args: Record<string, string>, at = 1_700_000_000) =>
    db.query("INSERT INTO pot_events (tx_hash, log_index, block_number, block_time, event_name, pot_id, args, source) VALUES ($1,$2,$3,$4,$5,$6,$7,'rpc')", [
      `0x${(++n).toString(16).padStart(64, "0")}`,
      0,
      n,
      at,
      name,
      pot,
      JSON.stringify(args),
    ]);
  const pot = "1000000001";
  await ev("Transfer", pot, { from: Z, to: A, tokenId: "2000000002" });
  await ev("Transfer", pot, { from: Z, to: B, tokenId: "2000000003" });
  await ev("MakerTreat", pot, { potId: pot, payer: B, to: A, amount: "10000" });
  await ev("ReferralTreat", pot, { potId: pot, payer: B, referrer: C, amount: "2500" });
  await ev("ExitFee", pot, { potId: pot, payer: A, to: B, amount: "48000" });
  await ev("CopyMarked", null, { tokenId: "2000000004", leader: A, leaderToken: "2000000002" });
  await ev("Paid", pot, { potId: pot, to: A, amount: "3000000" });
  await db.query("INSERT INTO pots (pot_id, condition_id, state, data, yes_owner, no_owner) VALUES ($1,'0x01',5,'{}',$2,$3)", [pot, A, B]);
  return db;
}

describe("treats and the leaderboard (from contract events only)", () => {
  it("lists an account's treats with their totals", async () => {
    const db = await seeded();
    const t = await treatsOf(db, A);
    expect(t.total).toBe("10000");
    expect(t.totals.MakerTreat).toBe("10000");
    expect(t.copycats).toBe(1);
    expect((await treatsOf(db, C)).totals.ReferralTreat).toBe("2500");
    expect((await treatsOf(db, C)).referred).toBe(1);
  });
  it("ranks players and limits the friends view to players met in a pot", async () => {
    const db = await seeded();
    const all = await leaderboard(db, {});
    expect(all.rows.map((r) => r.account).sort()).toEqual([A, B]);
    const a = all.rows.find((r) => r.account === A)!;
    expect(a).toMatchObject({ pots: 1, treats: "10000", copycats: 1, paid: "3000000" });
    const friends = await leaderboard(db, { friendsOf: C });
    expect(friends.rows).toEqual([]);
    expect((await leaderboard(db, { friendsOf: A })).rows.length).toBe(2);
    expect((await leaderboard(db, { days: 1 })).rows).toEqual([]); // the events are from 2023
  });
  it("unlocks cosmetics by milestones and names the next one", async () => {
    const db = await seeded();
    const p = (await progressOf(db, [A]))[A]!;
    expect(p).toMatchObject({ pots: 1, treats: 1, followers: 1 });
    const c = cosmeticsOf(p);
    expect(c.unlocked.map((u) => u.wear)).toEqual(["bell", "bow", "crown"]);
    expect(c.wear).toBe("crown");
    expect(c.next).toMatchObject({ wear: "scarf", left: "4 more pots" });
    expect(cosmeticsOf({ pots: 0, heldToEnd: 0, handshakes: 0, treats: 0, followers: 0 }).wear).toBe(null);
  });
});
