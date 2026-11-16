import { z } from "zod";
import { address, errorResponse, getDb } from "@/server/relay";
import { issuePotSession } from "@/server/potEvidence";
import { assertionBody } from "@/server/webauthn";

const body = z.union([
  z.object({ account: address, message: z.string().min(50).max(2000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  z.object({ account: address, message: z.string().min(50).max(2000), passkey: assertionBody }),
]);

/** A side signs a Sign-In with Ethereum message once and gets a one-hour session token for the raw readings. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const input = body.parse(await req.json().catch(() => null));
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    return Response.json(await issuePotSession(await getDb(), id, input as never, host));
  } catch (err) {
    return errorResponse(err);
  }
}
