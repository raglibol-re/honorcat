import { connection } from "next/server";
import { errorResponse, getDb, perps } from "@/server/relay";

/** Each rope of a perp: its posts, its times, and the price window that decided it. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const ropes = await perps.perpRopes(await getDb(), id);
    return Response.json({ ropes }, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=15" } });
  } catch (err) {
    return errorResponse(err);
  }
}
