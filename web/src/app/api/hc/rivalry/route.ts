import { connection } from "next/server";
import { address, errorResponse, getDb, treats } from "@/server/relay";

/** Head to head between two players: ?a=0x…&b=0x… (finished pots, practice excluded). */
export async function GET(req: Request) {
  await connection();
  try {
    const q = new URL(req.url).searchParams;
    const a = address.parse(q.get("a"));
    const b = address.parse(q.get("b"));
    const r = await treats.rivalry(await getDb(), a, b);
    return Response.json(r, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (err) {
    return errorResponse(err);
  }
}
