import { connection } from "next/server";
import { errorResponse, getDb, pots } from "@/server/relay";

/** Open pots waiting for this side on a market, and open groups on it (?symbol=GEMI-…&side=0|1). */
export async function GET(req: Request) {
  await connection();
  try {
    const q = new URL(req.url).searchParams;
    const c = q.get("symbol") ?? "";
    if (!/^[A-Z0-9-]{3,120}$/i.test(c)) return Response.json({ error: "bad symbol" }, { status: 400 });
    const side = q.get("side") === "1" ? 1 : 0;
    return Response.json(await pots.openOnMarket(await getDb(), c, side), { headers: { "cache-control": "public, s-maxage=10" } });
  } catch (err) {
    return errorResponse(err);
  }
}
