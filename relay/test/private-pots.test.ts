import { describe, expect, it } from "vitest";
import { memoryDb } from "../src/db";
import { maySee } from "../src/privatePots";
import { listPotsHc } from "../src/pots";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";

describe("a private pot is seen only by its players and people with the link", () => {
  it("needs the key or a player's account, and leaves the public list", async () => {
    const db = await memoryDb();
    await db.query("INSERT INTO pots (pot_id, state, data, condition_id, yes_owner, no_owner) VALUES (5, 3, '{}', '0x01', $1, $2), (6, 3, '{}', '0x01', $1, $2)", [A, B]);
    await db.query("INSERT INTO pot_private (pot_id, key, by_account) VALUES ('5', 'secret-key', $1)", [A]);
    expect((await maySee(db, "6", {})).ok).toBe(true);
    expect((await maySee(db, "5", {})).ok).toBe(false);
    expect((await maySee(db, "5", { key: "wrong" })).ok).toBe(false);
    expect((await maySee(db, "5", { key: "secret-key" })).ok).toBe(true);
    expect((await maySee(db, "5", { account: B } as never)).ok).toBe(false); // an address alone proves nothing
    const ids = (await listPotsHc(db, { states: [3] }).catch(() => [])).map((p: { potId: string }) => p.potId);
    expect(ids).toContain("6");
    expect(ids).not.toContain("5");
  });
});
