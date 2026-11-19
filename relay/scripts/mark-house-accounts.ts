/** One-off (2026-11-19): marks every test account in data/e2e-keys.jsonl as HonorCat's own, then recomputes honor. Prints counts only. */
import { readFileSync } from "node:fs";
import { getDb } from "../src/db";
import { recomputeHonor } from "../src/honor/store";
import { markHouse } from "./house";

const rows = readFileSync(new URL("../../data/e2e-keys.jsonl", import.meta.url), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l) as { address: string; what?: string });
await markHouse(rows.map((r) => r.address), "test account (scripts)");
const db = await getDb();
console.log("house accounts:", (await db.query<{ n: string }>("SELECT count(*)::text AS n FROM house_accounts"))[0]!.n);
console.log("honor recomputed:", JSON.stringify(await recomputeHonor(db)).slice(0, 200));
process.exit(0);
