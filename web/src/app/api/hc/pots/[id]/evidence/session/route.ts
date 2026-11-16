import { z } from "zod";
import { address, errorResponse, getDb } from "@/server/relay";
import { issuePotSession } from "@/server/potEvidence";
import { assertionBody } from "@/server/webauthn";

const body = z.union([
  z.object({ account: address, issuedAt: z.string().min(10), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  z.object({ account: address, issuedAt: z.string().min(10), passkey: assertionBody }),
]);

/** A side signs potEvidenceMessage(...) once and gets a one-hour session token for the raw readings. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const input = body.parse(await req.json().catch(() => null));
    return Response.json(await issuePotSession(await getDb(), id, input as never));
  } catch (err) {
    return errorResponse(err);
  }
}
