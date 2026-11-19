import { connection } from "next/server";
import { errorResponse, getDb, pots } from "@/server/relay";

/** The pot's newest price window (last ten minutes): what is priced, its times, samplers reported. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    return Response.json({ pricing: await pots.potPricing(await getDb(), id) }, { headers: { "cache-control": "public, s-maxage=1, stale-while-revalidate=2" } });
  } catch (err) {
    return errorResponse(err);
  }
}
