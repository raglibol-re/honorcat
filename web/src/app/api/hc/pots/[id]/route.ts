import { connection } from "next/server";
import { agentInfoOf, errorResponse, getDb, nudgeRelay, pots, privatePots } from "@/server/relay";

export const maxDuration = 60;

/** One pot: chain state, market, owners and its attestation requests (with each sampler's average). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    // A private pot: only its players and people with the link's key (?k=) see it.
    const q = new URL(req.url).searchParams;
    const see = await privatePots.maySee(db, id, { key: q.get("k"), account: q.get("account") });
    if (!see.ok) return Response.json({ error: "this pot is private", private: true }, { status: 403, headers: { "cache-control": "no-store" } });
    nudgeRelay("hc:pot", { samplerBudgetMs: 45_000 });
    // Who minds or plays this pot as an agent, their actions with reasons, and open proposals.
    const agent = await agentInfoOf(db, id).catch(() => null);
    return Response.json(
      { ...d, agent, private: see.private, privateKey: "key" in see ? see.key : null },
      { headers: { "cache-control": see.private ? "no-store" : "public, s-maxage=2, stale-while-revalidate=5" } },
    );
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
