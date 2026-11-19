import { connection } from "next/server";
import { errorResponse, getDb, privatePots } from "@/server/relay";
import { checkPotSession, rawRecords } from "@/server/potEvidence";

/** Every sampler's full evidence record for the pot, raw readings included. Sides only (session token). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    // A private pot: only with its link's key (?k=).
    await privatePots.assertMaySee(await getDb(), id, new URL(req.url).searchParams.get("k"));
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const who = checkPotSession(id, (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || null);
    if (!who) return Response.json({ error: "sign in as a side of this pot first" }, { status: 401 });
    return Response.json({ account: who, records: await rawRecords(await getDb(), id) }, { headers: { "cache-control": "no-store, private" } });
  } catch (err) {
    return errorResponse(err);
  }
}
