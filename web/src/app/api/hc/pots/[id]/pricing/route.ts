import { connection } from "next/server";
import { errorResponse, getDb, pots, privatePots } from "@/server/relay";

/** The pot's newest price window (last ten minutes): what is priced, its times, samplers reported. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    // A private pot: only with its link's key (?k=).
    await privatePots.assertMaySee(await getDb(), id, new URL(req.url).searchParams.get("k"));
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    return Response.json({ pricing: await pots.potPricing(await getDb(), id) }, { headers: { "cache-control": "public, s-maxage=1, stale-while-revalidate=2" } });
  } catch (err) {
    return errorResponse(err);
  }
}
