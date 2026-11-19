import { connection } from "next/server";
import { address, errorResponse, getDb, honor, social } from "@/server/relay";

/** The honor table: ?days=7 (0 = all time), ?friendsOf=0x… or ?following=0x…. 404 while off. */
export async function GET(req: Request) {
  await connection();
  try {
    if (!honor.honorOn()) return Response.json({ off: true }, { status: 404 });
    const q = new URL(req.url).searchParams;
    const db = await getDb();
    const days = Math.max(0, Math.min(3650, Number(q.get("days") ?? 0) || 0));
    let only: string[] | null = null;
    const f = q.get("friendsOf");
    const fo = q.get("following");
    if (f) {
      const a = address.parse(f).toLowerCase();
      const rows = await db.query<{ f: string }>(
        `SELECT DISTINCT CASE WHEN yes_owner = $1 THEN no_owner ELSE yes_owner END AS f FROM pots WHERE (yes_owner = $1 OR no_owner = $1) AND yes_owner IS NOT NULL AND no_owner IS NOT NULL`,
        [a],
      );
      only = [a, ...rows.map((r) => r.f)];
    } else if (fo) {
      const a = address.parse(fo).toLowerCase();
      only = [a, ...(await social.followsOf(db, a)).following];
    }
    return Response.json({ rows: await honor.honorBoard(db, { days, only }) }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (err) {
    return errorResponse(err);
  }
}
