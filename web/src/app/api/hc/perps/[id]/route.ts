import { connection } from "next/server";
import { errorResponse, getDb, nudgeRelay, perps } from "@/server/relay";

export const maxDuration = 60;

/** One perp: its terms, players, budgets, the current rope and every rope so far. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const db = await getDb();
    let d = await perps.perpDetail(db, id);
    if (!d) {
      await perps.syncPerp(db, BigInt(id)).catch(() => null);
      d = await perps.perpDetail(db, id);
    }
    if (!d) return Response.json({ error: "no such perp" }, { status: 404 });
    nudgeRelay("hc:perp", { samplerBudgetMs: 45_000 });
    return Response.json(d, { headers: { "cache-control": "public, s-maxage=2, stale-while-revalidate=5" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Re-reads the perp from the chain (after a wallet sent its own transaction). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const db = await getDb();
    await perps.syncPerp(db, BigInt(id));
    nudgeRelay("hc:perp", { samplerBudgetMs: 45_000 });
    return Response.json(await perps.perpDetail(db, id));
  } catch (err) {
    return errorResponse(err);
  }
}
