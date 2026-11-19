/** One-off (2026-11-19): record lost practice pots, then recompute honor. Prints counts only. */
import { getDb } from "../src/db";
import { markPracticePots } from "../src/practice";
import { recomputeHonor } from "../src/honor/store";

const db = await getDb();
const before = (await db.query<{ n: string }>("SELECT count(*)::text AS n FROM practice_pots"))[0]!.n;
await markPracticePots(db);
const after = (await db.query<{ n: string }>("SELECT count(*)::text AS n FROM practice_pots"))[0]!.n;
console.log(`practice pots recorded: ${before} -> ${after}`);
const r = await recomputeHonor(db);
console.log("honor recomputed:", JSON.stringify(r).slice(0, 300));
process.exit(0);
