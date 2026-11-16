import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { memoryDb } from "../src/db";
import { seatAct, seatByToken, SEAT_ACTIONS } from "../src/agentSeats";
import { cleanPowers, decide } from "../src/catSitter";

const A = "0x00000000000000000000000000000000000000aa";
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function seed(opts: { expiresIn?: string; revoked?: boolean } = {}) {
  const db = await memoryDb();
  const token = "hcs_testtokentesttokentesttoken";
  await db.query(
    `INSERT INTO agent_seats (id, account, label, token_hash, max_notional, max_pots, expires_at, revoked_at)
     VALUES ('s1', $1, 'My Grok Bot', $2, 2000000, 10, now() + $3::interval, $4)`,
    [A, hash(token), opts.expiresIn ?? "1 hour", opts.revoked ? new Date().toISOString() : null],
  );
  return { db, token };
}
const powers = { setNet: "approval", setBowl: "off", partialExit: "approval", fullExit: "off", acceptHandshake: "approval" } as const;
async function mind(db: Awaited<ReturnType<typeof memoryDb>>) {
  await db.query("INSERT INTO seat_pots (pot_id, seat_id, account, side, powers) VALUES (5, 's1', $1, 0, $2)", [A, JSON.stringify(powers)]);
}

describe("agent seats", () => {
  it("find a live seat by its token and nothing else", async () => {
    const { db, token } = await seed();
    expect((await seatByToken(db, token))?.id).toBe("s1");
    expect(await seatByToken(db, "hcs_wrongtokenwrongtokenwrong")).toBeNull();
    expect(await seatByToken(db, "not-a-token")).toBeNull();
  });
  it("stop at once when revoked or expired", async () => {
    const revoked = await seed({ revoked: true });
    expect(await seatByToken(revoked.db, revoked.token)).toBeNull();
    await expect(seatAct(revoked.db, "s1", "list_invites")).rejects.toThrow(/revoked or has expired/);
    const expired = await seed({ expiresIn: "-1 minute" });
    expect(await seatByToken(expired.db, expired.token)).toBeNull();
    await expect(seatAct(expired.db, "s1", "read_pot", { potId: "5" })).rejects.toThrow(/revoked or has expired/);
  });
  it("cannot go beyond its action list, and never withdraws", async () => {
    const { db } = await seed();
    for (const bad of ["withdraw", "create_pot", "transfer", "set_name"]) await expect(seatAct(db, "s1", bad)).rejects.toThrow(/not an action this seat may take/);
    expect(SEAT_ACTIONS).not.toContain("withdraw");
  });
  it("needs a one-line reason for anything that changes a pot", async () => {
    const { db } = await seed();
    await mind(db);
    await expect(seatAct(db, "s1", "set_net", { potId: "5", percent: 40 })).rejects.toThrow(/one-line reason/);
  });
  it("as a cat sitter, proposes what needs approval and refuses what is off", async () => {
    const { db } = await seed();
    await mind(db);
    const r = (await seatAct(db, "s1", "set_net", { potId: "5", percent: 40, reason: "the price has fallen 6 points in an hour" })) as { proposed: boolean };
    expect(r.proposed).toBe(true);
    await expect(seatAct(db, "s1", "set_bowl", { potId: "5", percent: 90, reason: "lock in a gain" })).rejects.toThrow(/did not give the sitter "setBowl"/);
    await expect(seatAct(db, "s1", "request_exit", { potId: "5", part: "full", reason: "leave" })).rejects.toThrow(/did not give the sitter "fullExit"/);
    const p = (await seatAct(db, "s1", "request_exit", { potId: "5", part: "partial", reason: "take a ninth off" })) as { proposed: boolean };
    expect(p.proposed).toBe(true);
    const logged = await db.query<{ reason: string }>("SELECT reason FROM agent_actions WHERE ok ORDER BY id");
    expect(logged.map((x) => x.reason)).toEqual(["the price has fallen 6 points in an hour", "take a ninth off"]);
  });
  it("can act alone only on exits signed in advance", () => {
    const c = cleanPowers({ setNet: "alone", setBowl: "alone", acceptHandshake: "alone", fullExit: "alone", partialExit: "bogus" });
    expect(c).toEqual({ setNet: "approval", setBowl: "approval", acceptHandshake: "approval", fullExit: "alone", partialExit: "off" });
    expect(decide(c, "fullExit")).toBe("act");
    expect(decide(c, "setNet")).toBe("propose");
    expect(decide(c, "partialExit")).toBe("refuse");
  });
});
