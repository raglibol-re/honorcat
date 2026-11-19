import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, privatePots } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const base = { account: address, issuedAt: z.string().min(10) };
const body = z.union([z.object({ ...base, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ ...base, passkey: assertionBody })]);

/** A player makes the pot private (signed); answers the key its private link carries. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) throw Object.assign(new Error("bad pot id"), { status: 400 });
    const b = body.parse(await req.json());
    return Response.json(await privatePots.makePrivate(await getDb(), { ...b, potId: id } as Parameters<typeof privatePots.makePrivate>[1]), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
