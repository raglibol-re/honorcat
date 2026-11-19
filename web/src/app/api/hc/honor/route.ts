import { connection } from "next/server";
import { address, errorResponse, getDb, honor } from "@/server/relay";

/**
 * Honor: ?account=0x… gives that player's points, title, cosmetics and history; ?accounts=a,b,…
 * (up to 200) gives points and titles for lists. 404 while Honor is switched off.
 */
export async function GET(req: Request) {
  await connection();
  try {
    if (!honor.honorOn()) return Response.json({ off: true }, { status: 404 });
    const q = new URL(req.url).searchParams;
    const db = await getDb();
    const many = q.get("accounts");
    if (many) {
      const list = many.split(",").map((a) => address.parse(a.trim()));
      return Response.json({ honor: await honor.honorMany(db, list), state: await honor.honorState(db) }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
    }
    const a = address.parse(q.get("account"));
    return Response.json({ ...(await honor.honorOf(db, a, { history: q.get("history") === "1" || q.get("latest") === "1", limit: q.get("latest") === "1" ? 1 : 300 })), state: await honor.honorState(db) }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } });
  } catch (err) {
    return errorResponse(err);
  }
}
