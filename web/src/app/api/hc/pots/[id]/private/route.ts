import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, privatePots } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const base = { account: address, issuedAt: z.string().min(10), action: z.enum(["make", "key"]).default("make") };
const body = z.union([z.object({ ...base, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ ...base, passkey: assertionBody })]);

/** A player makes the pot private, or (action "key") gets the key of its private link; signed either way. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) throw Object.assign(new Error("bad pot id"), { status: 400 });
    const b = body.parse(await req.json());
    // "key": a player of a private pot, without its link, proves it with a signature and gets the key.
    if (b.action === "key") return Response.json(await privatePots.keyForPlayer(await getDb(), { ...b, potId: id } as Parameters<typeof privatePots.keyForPlayer>[1]), { headers: { "cache-control": "no-store" } });
    return Response.json(await privatePots.makePrivate(await getDb(), { ...b, potId: id } as Parameters<typeof privatePots.makePrivate>[1]), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
