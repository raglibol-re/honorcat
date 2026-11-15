import { z } from "zod";
import { address, errorResponse, getDb } from "@/server/relay";
import { issueSession } from "@/server/evidence";
import { assertionBody } from "@/server/webauthn";

const body = z.union([
  z.object({ account: address, issuedAt: z.string().min(10), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  z.object({ account: address, issuedAt: z.string().min(10), passkey: assertionBody }),
]);

/** The funder or a recipient signs evidenceMessage(...) once and gets a one-hour session token. */
export async function POST(req: Request, ctx: RouteContext<"/api/early/[id]/evidence/session">) {
  try {
    const { id } = await ctx.params;
    const input = body.parse(await req.json().catch(() => null));
    return Response.json(await issueSession(await getDb(), id, input as never));
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status && e.message) return Response.json({ error: e.message }, { status: e.status });
    return errorResponse(err);
  }
}
