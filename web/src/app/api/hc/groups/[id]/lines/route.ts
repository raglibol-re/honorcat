import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, groups } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const base = { account: address, lines: z.tuple([z.string().max(80), z.string().max(80)]), issuedAt: z.string().min(10) };
const body = z.union([z.object({ ...base, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ ...base, passkey: assertionBody })]);

/** Each team's short line, written once by the creator (signed) right after the group opens. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const b = body.parse(await req.json());
    return Response.json(await groups.setGroupLines(await getDb(), { ...b, groupId: id } as Parameters<typeof groups.setGroupLines>[1]));
  } catch (err) {
    return errorResponse(err);
  }
}
