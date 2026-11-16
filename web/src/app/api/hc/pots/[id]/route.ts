import { connection } from "next/server";
import { errorResponse, getDb, nudgeRelay, pots } from "@/server/relay";

export const maxDuration = 60;

/** One pot: chain state, market, owners and its attestation requests (with each sampler's average). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const db = await getDb();
    let d = await pots.potDetail(db, id);
    if (!d) {
      await pots.syncPot(db, BigInt(id)).catch(() => null);
      d = await pots.potDetail(db, id);
    }
    if (!d) return Response.json({ error: "no such pot" }, { status: 404 });
    nudgeRelay("hc:pot", { samplerBudgetMs: 45_000 });
    return Response.json(d, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Re-reads the pot from the chain (after a wallet sent its own transaction). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const db = await getDb();
    await pots.syncPot(db, BigInt(id));
    nudgeRelay("hc:sync", { samplerBudgetMs: 45_000 });
    return Response.json(await pots.potDetail(db, id));
  } catch (err) {
    return errorResponse(err);
  }
}
