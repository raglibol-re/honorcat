import { describe, expect, it } from "vitest";
import { memoryDb } from "../src/db";
import { actOnDraft, createDraft } from "../src/drafts";
import { addNote, playersOf } from "../src/potNotes";

const A = "0x00000000000000000000000000000000000000aA";
const B = "0x00000000000000000000000000000000000000bB";
const C = "0x00000000000000000000000000000000000000cC";

async function seed(state: number) {
  const db = await memoryDb();
  let i = 0;
  for (const [to, tok] of [[A, "14"], [B, "15"]] as const)
    await db.query("INSERT INTO pot_events (tx_hash, log_index, block_number, block_time, event_name, pot_id, args, source) VALUES ($1,0,$2,$2,'Transfer',7,$3,'rpc')", [
      `0x${(++i).toString(16).padStart(64, "0")}`,
      i,
      JSON.stringify({ from: "0x0000000000000000000000000000000000000000", to, tokenId: tok }),
    ]);
  await db.query("INSERT INTO pots (pot_id, state, data, condition_id) VALUES (7, $1, '{}', '0x01')", [state]);
  return db;
}
const note = (account: string) => ({ potId: "7", account: account as `0x${string}`, kind: "well_played" as const, issuedAt: new Date().toISOString(), signature: "0x00" as `0x${string}` });

describe("notes after a pot", () => {
  it("knows the players from the contract's events", async () => {
    expect((await playersOf(await seed(5), "7")).sort()).toEqual([A.toLowerCase(), B.toLowerCase()]);
  });
  it("only after the pot ended, and only from its players", async () => {
    await expect(addNote(await seed(3), note(A))).rejects.toThrow(/have ended/);
    await expect(addNote(await seed(5), note(C))).rejects.toThrow(/only the players/);
  });
  it("a rematch seat is reserved for the other player", async () => {
    const db = await seed(5);
    const { id } = await createDraft(db, { account: A, kind: "wallet" });
    const raw = (await db.query<{ data: string | object }>("SELECT data FROM pot_drafts WHERE id = $1", [id]))[0]!.data;
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    await db.query("UPDATE pot_drafts SET data = $2 WHERE id = $1", [id, JSON.stringify({ ...data, reservedFor: B.toLowerCase() })]);
    await expect(actOnDraft(db, id, { action: "sit", account: C, kind: "wallet" })).rejects.toThrow(/reserved/);
    const ok = await actOnDraft(db, id, { action: "sit", account: B, kind: "wallet" });
    expect("token" in ok).toBe(true);
  });
});
