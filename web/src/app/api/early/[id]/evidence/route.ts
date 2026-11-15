import { connection } from "next/server";
import { earlyDetail, getDb } from "@/server/relay";
import { checkSession } from "@/server/evidence";

/**
 * Every sampler's full signed record (raw bid, ask and sizes per reading) and the raw samples, for
 * the pot's funder and recipients only: `Authorization: Bearer <token from ./session>`.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/early/[id]/evidence">) {
  await connection();
  const { id } = await ctx.params;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const who = checkSession(id, token);
  if (!who) return Response.json({ error: "sign in as this payout’s funder or a recipient to see the raw readings" }, { status: 401 });
  const d = await earlyDetail(await getDb(), id);
  if (!d) return Response.json({ error: "early payout not found" }, { status: 404 });
  return Response.json({ id, viewer: who, signatures: d.signatures, samples: d.samples }, { headers: { "cache-control": "private, no-store" } });
}
