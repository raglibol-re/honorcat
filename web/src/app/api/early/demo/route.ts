import { after, connection } from "next/server";
import { DEMO_MAX_AGE_MS, DEMO_REFRESH_MS, cachedDemo, demoCandidates, refreshDemo } from "@/server/early";
import { getDb } from "@/server/relay";

export const maxDuration = 30;

/**
 * Live Gemini contracts best suited for a demo: `trigger` (already above the threshold, pays within
 * minutes), `watch` (a little below it, so the crossing can be watched) and `refund` (closes soon,
 * far below). Served from the server's precomputed result (refreshed from the Streams webhook);
 * computed on the spot only when that is missing or stale, or with `?fresh=1`.
 */
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const bps = Number(url.searchParams.get("threshold") ?? 8500);
  const headers = { "cache-control": "no-store" };
  try {
    if (bps !== 8500 || url.searchParams.get("fresh") === "1") {
      const c = await demoCandidates(Number.isInteger(bps) && bps >= 5000 && bps <= 9900 ? bps : 8500);
      return Response.json({ ...c, fetchedAt: new Date().toISOString(), cached: false }, { headers });
    }
    const db = await getDb();
    const cached = await cachedDemo(db);
    if (cached && Date.now() - cached.at < DEMO_MAX_AGE_MS) {
      if (Date.now() - cached.at > DEMO_REFRESH_MS) after(() => refreshDemo(db).catch((e) => console.error("[demo] refresh", e)));
      const { at, ...c } = cached;
      return Response.json({ ...c, fetchedAt: new Date(at).toISOString(), cached: true }, { headers });
    }
    const fresh = await refreshDemo(db, { force: !cached });
    const { at, ...c } = fresh ?? { ...(await demoCandidates()), at: Date.now() };
    return Response.json({ ...c, fetchedAt: new Date(at).toISOString(), cached: false }, { headers });
  } catch (err) {
    return Response.json({ error: `Gemini is unavailable: ${(err as Error).message}` }, { status: 502 });
  }
}
