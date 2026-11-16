/**
 * Re-reads pots from the chain into the database (after a schema or projection change).
 * Usage: tsx --env-file=../.env scripts/pots-resync.ts [potId ...]   (no ids: every known pot)
 */
import { getDb } from "../src/db";
import { syncPot } from "../src/pots";

const db = await getDb();
const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const all = ids.length ? ids : (await db.query<{ pot_id: string }>("SELECT pot_id::text AS pot_id FROM pots ORDER BY pot_id")).map((r) => r.pot_id);
for (const id of all) {
  const r = await syncPot(db, BigInt(id));
  console.log(`pot ${id}: state ${r?.state ?? "none"}, size at creation ${(r?.data as { initialNotional?: string } | undefined)?.initialNotional ?? "?"}`);
}
process.exit(0);
