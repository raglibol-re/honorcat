import { connection } from "next/server";
import { address, cosmetics, errorResponse, getDb, honor } from "@/server/relay";

/** A player's cat cosmetics: what is unlocked, what the cat wears and the next unlock. */
export async function GET(req: Request) {
  await connection();
  try {
    const account = address.parse(new URL(req.url).searchParams.get("account")).toLowerCase();
    const db = await getDb();
    // With Honor on, cosmetics come from honor thresholds (they replace the milestone unlocks).
    if (honor.honorOn()) {
      const h = await honor.honorOf(db, account);
      return Response.json({ ...h.cosmetics, honor: { points: h.points, title: h.title } }, { headers: { "cache-control": "no-store" } });
    }
    const p = (await cosmetics.progressOf(db, [account]))[account]!;
    return Response.json(cosmetics.cosmeticsOf(p), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
