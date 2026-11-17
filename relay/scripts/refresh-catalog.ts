/**
 * One full sweep of Gemini's events list into the market catalogue (e.g. after adding a field).
 * Usage: DATABASE_URL=<prod> tsx --env-file=../.env scripts/refresh-catalog.ts
 */
import { getDb } from "../src/db";
import * as catalog from "../src/catalog";
import { GEMINI_REST } from "../src/gemini";

const db = await getDb();
const fetchJson = async (path: string) => {
  const r = await fetch(GEMINI_REST + path, { signal: AbortSignal.timeout(10_000) });
  if (r.status === 404 || r.status === 429) return null;
  const t = await r.text();
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  return JSON.parse(t);
};
for (let i = 0; i < 60; i++) {
  const s = await catalog.refreshStep(db, fetchJson, { listBudget: 10, bookBudget: 0 });
  console.log(`step ${i}: pages ${s.pages}, rows ${s.rows}, swept ${s.swept}`);
  if (s.swept && i > 0) break;
}
process.exit(0);
