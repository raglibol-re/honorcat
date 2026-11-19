import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, groups } from "@/server/relay";

const body = z.object({ account: address, lines: z.tuple([z.string().max(80), z.string().max(80)]) });

/** Each team's short line, written once by the creator right after the group opens. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const b = body.parse(await req.json());
    return Response.json(await groups.setGroupLines(await getDb(), id, b.account, b.lines));
  } catch (err) {
    return errorResponse(err);
  }
}
