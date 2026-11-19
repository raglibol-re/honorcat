import { connection } from "next/server";
import { errorResponse, getDb, groups, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

const accountOf = (req: Request) => {
  const a = new URL(req.url).searchParams.get("account");
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null;
};

/** One group: teams, members per team, prices so far, the clock, and (?account=) my standing. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const db = await getDb();
    const account = accountOf(req);
    let d = await groups.groupDetail(db, id, account);
    if (!d) {
      await groups.syncGroup(db, BigInt(id)).catch(() => null);
      d = await groups.groupDetail(db, id, account);
    }
    if (!d) return Response.json({ error: "no such group" }, { status: 404 });
    nudgeRelay("hc:group", { samplerBudgetMs: 45_000 });
    return Response.json(d, { headers: { "cache-control": account ? "no-store" : "public, s-maxage=2, stale-while-revalidate=5" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Re-reads the group (and ?account=) from the chain after a wallet sent its own transaction. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const db = await getDb();
    await groups.syncGroup(db, BigInt(id));
    nudgeRelay("hc:group", { samplerBudgetMs: 45_000 });
    return Response.json(await groups.groupDetail(db, id, accountOf(req)));
  } catch (err) {
    return errorResponse(err);
  }
}
