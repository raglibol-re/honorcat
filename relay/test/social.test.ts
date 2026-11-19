import { describe, expect, it } from "vitest";
import { memoryDb } from "../src/db";
import { recentPlays, streaksOf } from "../src/social";

const A = "0x00000000000000000000000000000000000000aa";
const day = 86_400;

async function mint(db: Awaited<ReturnType<typeof memoryDb>>, i: number, t: number, to = A) {
  await db.query(
    "INSERT INTO pot_events (tx_hash, log_index, block_number, block_time, event_name, pot_id, args, source) VALUES ($1, 0, $2, $3, 'Transfer', $4, $5, 'test')",
    [`0x${i.toString(16).padStart(4, "0")}`, i, t, i, JSON.stringify({ from: `0x${"0".repeat(40)}`, to, tokenId: String(i * 2) })],
  );
}

describe("streaks and the break reminder", () => {
  it("counts consecutive UTC days back from today, and the best run", async () => {
    const db = await memoryDb();
    const today = Math.floor(Date.now() / 1000 / day) * day + 3600;
    // a 4-day run long ago, then today and the two days before
    for (const [i, d] of [[1, 30], [2, 29], [3, 28], [4, 27], [5, 2], [6, 1], [7, 0], [8, 0]] as const) await mint(db, i, today - d * day);
    const s = (await streaksOf(db, [A]))[A]!;
    expect(s.best).toBe(4);
    expect(s.current).toBe(3);
    expect(s.days).toBe(7);
  });

  it("keeps a streak alive until the end of the next day", async () => {
    const db = await memoryDb();
    const today = Math.floor(Date.now() / 1000 / day) * day + 3600;
    await mint(db, 1, today - 2 * day);
    await mint(db, 2, today - day);
    expect((await streaksOf(db, [A]))[A]!.current).toBe(2);
    const db2 = await memoryDb();
    await mint(db2, 1, today - 3 * day);
    await mint(db2, 2, today - 2 * day);
    expect((await streaksOf(db2, [A]))[A]!.current).toBe(0);
  });

  it("counts pots started in the last three hours", async () => {
    const db = await memoryDb();
    const now = Math.floor(Date.now() / 1000);
    for (let i = 1; i <= 5; i++) await mint(db, i, now - i * 600);
    await mint(db, 9, now - 4 * 3600);
    expect((await recentPlays(db, A)).lastThreeHours).toBe(5);
  });
});
