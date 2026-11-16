import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, getDb, handshakeOffers, nudgeRelay, offerHandshake } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({
  side: z.union([z.literal(0), z.literal(1)]),
  priceYes: z.number().int().min(0).max(1_000_000),
  notional: z.string().regex(/^\d+$/),
  deadline: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/** Open handshake offers on this pot (unexpired). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    return Response.json({ offers: await handshakeOffers(await getDb(), id) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** One owner's signed handshake terms. When the other side signed the same terms, it is submitted. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const b = body.parse(await req.json());
    const r = await offerHandshake(await getDb(), { potId: id, ...b, signature: b.signature as `0x${string}` });
    nudgeRelay("hc:handshake");
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
