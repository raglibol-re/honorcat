import { connection } from "next/server";
import { errorResponse, getDb, pots } from "@/server/relay";

/** An account's honor record: facts from the pot events only. Public. */
export async function GET(_req: Request, ctx: { params: Promise<{ account: string }> }) {
  await connection();
  try {
    const { account } = await ctx.params;
    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return Response.json({ error: "bad address" }, { status: 400 });
    return Response.json(await pots.honorRecord(await getDb(), account), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
