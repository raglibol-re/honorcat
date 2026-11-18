import { connection } from "next/server";
import { address, errorResponse, getDb, treats } from "@/server/relay";

/** The leaderboard: ?days=7 (0 = all time) and ?friendsOf=0x… (that player and the players they met in a pot). */
export async function GET(req: Request) {
  await connection();
  try {
    const q = new URL(req.url).searchParams;
    const days = Math.max(0, Math.min(3650, Number(q.get("days") ?? 7) || 0));
    const f = q.get("friendsOf");
    const friendsOf = f ? address.parse(f) : null;
    return Response.json(await treats.leaderboard(await getDb(), { days, friendsOf }), { headers: { "cache-control": "public, max-age=30" } });
  } catch (err) {
    return errorResponse(err);
  }
}
