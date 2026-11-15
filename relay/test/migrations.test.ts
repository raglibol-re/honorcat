import { describe, expect, it } from "vitest";
import { MIGRATIONS, openPglite } from "../src/db";

describe("migration 001: pots -> vault_pots", () => {
  it("renames the retired vault table with its rows, once", async () => {
    const db = await openPglite();
    await db.exec(`CREATE TABLE pots (pot_id NUMERIC PRIMARY KEY, status TEXT NOT NULL);
      CREATE INDEX pots_status_idx ON pots (status);
      INSERT INTO pots VALUES (19, 'open'), (20, 'resolved'), (21, 'expired');`);
    await db.exec(MIGRATIONS);
    const rows = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM vault_pots");
    expect(rows[0]!.n).toBe("3");
    expect(await db.query("SELECT to_regclass('public.pots') AS t")).toEqual([{ t: null }]);
    // Idempotent: running again changes nothing.
    await db.exec(MIGRATIONS);
    expect((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM vault_pots"))[0]!.n).toBe("3");
  });
});
