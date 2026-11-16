/**
 * Refills HonorCat's test-money pool (the relay wallet) from Circle's faucet API right now.
 * The app also does this by itself every 3 hours. Env: CIRCLE_API_KEY, RELAY_PRIVATE_KEY, DATABASE_URL.
 * Usage: tsx --env-file=../.env scripts/refill-pool.ts
 */
import { getDb } from "../src/db";
import { poolStatus, refillPool } from "../src/funding";

const db = await getDb();
console.log(JSON.stringify(await refillPool(db, { force: true }), null, 1));
await new Promise((r) => setTimeout(r, 15_000));
console.log(JSON.stringify(await poolStatus(db), null, 1));
process.exit(0);
