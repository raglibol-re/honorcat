import { connection } from "next/server";
import { errorResponse, getDb, nudgeRelay, pots, privatePots } from "@/server/relay";

export const maxDuration = 60;

/**
 * Signed fair-value quotes. POST opens a quote window (the samplers measure the next 30 s and sign
 * it; it never moves money); GET returns the newest quote with the signatures once two samplers
 * signed. Pass it to HonorCatFairValue.fairValue(pots, side, attestation, signatures, maxAge).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    // A private pot: only with its link's key (?k=).
    await privatePots.assertMaySee(await getDb(), id, new URL(req.url).searchParams.get("k"));
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const q = await pots.latestQuote(await getDb(), id);
    if (q && q.status !== "ready") nudgeRelay("hc:quote", { samplerBudgetMs: 45_000 });
    return Response.json(q ?? { error: "no quote yet; POST to request one" }, { status: q ? 200 : 404, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    // A private pot: only with its link's key (?k=).
    await privatePots.assertMaySee(await getDb(), id, new URL(req.url).searchParams.get("k"));
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const requestId = await pots.openQuote(await getDb(), id);
    nudgeRelay("hc:quote", { samplerBudgetMs: 45_000 });
    return Response.json({ id: requestId });
  } catch (err) {
    return errorResponse(err);
  }
}
