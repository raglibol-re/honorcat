/** Marks HonorCat's own test accounts (never players in honor, leaderboards or rivalry). */
import { getDb } from "../src/db";

export async function markHouse(accounts: string[], why: string) {
  const db = await getDb();
  for (const a of accounts) await db.query("INSERT INTO house_accounts (account, why) VALUES ($1, $2) ON CONFLICT (account) DO NOTHING", [a.toLowerCase(), why]);
}
