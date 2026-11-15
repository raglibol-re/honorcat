import { connection } from "next/server";
import { earlyDetail, getDb } from "@/server/relay";

/**
 * The most recent real early payout with enough valid samples to replay: the landing page shows
 * it, labelled as a replay, when no pot is open or being watched right now.
 */
export async function GET() {
  await connection();
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `SELECT e.id FROM early_pots e
     WHERE e.status = 'live' AND e.settled_kind = 'early' AND e.settled_at IS NOT NULL
       AND (SELECT count(*) FROM early_samples s WHERE s.early_id = e.id AND s.status = 0) >= 20
     ORDER BY e.settled_at DESC LIMIT 1`,
  );
  const d = rows[0] ? await earlyDetail(db, rows[0].id) : null;
  if (!d) return Response.json({ error: "no early payout to replay yet" }, { status: 404 });
  return Response.json(d, { headers: { "cache-control": "public, max-age=60" } });
}
