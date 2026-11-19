/**
 * Rebuilds a fresh database from public sources: the schema, Gemini's market catalogue, every pot
 * event from the pot contract's deploy block, each pot's market (its conditionId depends only on the
 * instrument, so it is matched exactly), and the practice-pot markers (pots whose other side is the
 * relay's wallet). Names, passkey registrations and drafts cannot be rebuilt: they never left the old
 * database. Usage (production): DATABASE_URL=$DATABASE_URL_PROD tsx --env-file=../.env scripts/rebuild-db.ts
 */
import { getDb } from "../src/db";
import * as catalog from "../src/catalog";
import { GEMINI_REST } from "../src/gemini";
import { relaySender } from "../src/chain";
import { indexPots, potConditionId, potParams, POT_MIN_SAMPLES, POT_WINDOW_S, registerMarket, syncPot } from "../src/pots";
import { paramsFor } from "../src/trigger/params";

const db = await getDb();
const fetchJson = async (path: string) => {
  const r = await fetch(GEMINI_REST + path, { signal: AbortSignal.timeout(10_000) });
  if (r.status === 404 || r.status === 429) return null;
  const t = await r.text();
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  return JSON.parse(t);
};

// 1. The catalogue (the events list, page by page, until a full sweep).
for (let i = 0; i < 60; i++) {
  const s = await catalog.refreshStep(db, fetchJson, { listBudget: 10, bookBudget: 0 });
  console.log(`catalogue step ${i}: pages ${s.pages}, rows ${s.rows}, swept ${s.swept}`);
  if (s.swept) break;
}

// 2. Every pot event from the deploy block (the poller trails the head by about a minute).
for (let i = 0; i < 400; i++) {
  const r = (await indexPots(db, { deadlineMs: 60_000 })) as { from?: string; to?: string; done?: boolean } | undefined;
  const cur = (await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'pots_cursor_v2'"))[0]?.value;
  console.log(`index pass ${i}: cursor ${cur}`, r ?? "");
  const head = await (await import("../src/chain")).publicClient().getBlockNumber();
  if (cur && BigInt(cur) >= head - 200n) break;
}

// 2b. Every perp event (HonorCatPerps), and each perp's state.
{
  const { indexPerps } = await import("../src/perps");
  const head = await (await import("../src/chain")).publicClient().getBlockNumber();
  for (let i = 0; i < 200; i++) {
    await indexPerps(db, head, { deadlineMs: 60_000 });
    const cur = (await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'perps_cursor'"))[0]?.value;
    console.log(`perps pass ${i}: cursor ${cur}`);
    if (!cur || BigInt(cur) >= head) break;
  }
}

// 3. Each pot's market, by its conditionId.
const params = potParams(paramsFor("demo"), POT_WINDOW_S, POT_MIN_SAMPLES);
const rows = await catalog.allRows(db, 0);
const byCondition = new Map(rows.map((r) => [potConditionId(r.symbol, params).toLowerCase(), r]));
const pots = await db.query<{ pot_id: string; condition_id: string; yes_owner: string | null; no_owner: string | null }>(
  "SELECT pot_id::text AS pot_id, condition_id, yes_owner, no_owner FROM pots ORDER BY pot_id",
);
let matched = 0;
for (const p of pots) {
  const r = byCondition.get(String(p.condition_id).toLowerCase());
  if (r) {
    await registerMarket(db, { instrument: r.symbol, eventTicker: r.eventTicker, contractTicker: r.contractTicker, eventTitle: r.eventTitle, label: r.label, params });
    matched++;
  }
}
console.log(`markets matched for ${matched} of ${pots.length} pots`);

// 4. Practice pots: the other side is the relay's own wallet.
const practice = relaySender().toLowerCase();
const pr = await db.query("INSERT INTO practice_pots (pot_id) SELECT pot_id FROM pots WHERE lower(yes_owner) = $1 OR lower(no_owner) = $1 ON CONFLICT DO NOTHING RETURNING pot_id", [practice]);
console.log(`practice pots marked: ${pr.length}`);

// 4b. Practice perps (the practice cat took the other side), stored under the negative perp id.
const pp = await db.query("INSERT INTO practice_pots (pot_id) SELECT -perp_id FROM perps WHERE lower(b) = $1 OR lower(a) = $1 ON CONFLICT DO NOTHING RETURNING pot_id", [practice]);
console.log(`practice perps marked: ${pp.length}`);

// 5. Re-read every pot so its projection includes the market.
for (const p of pots) await syncPot(db, BigInt(p.pot_id)).catch((e) => console.error("sync", p.pot_id, (e as Error).message));
console.log("done");
process.exit(0);
