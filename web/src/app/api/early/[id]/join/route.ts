import { z } from "zod";
import { address, errorResponse, getDb, joinEarly, nudgeRelay } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

export const maxDuration = 60;

const body = z.union([
  z.object({ account: address, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  z.object({ account: address, passkey: assertionBody }),
]);

/** A recipient joins by proving control of the account (passkey or signature). The relay pays gas. */
export async function POST(req: Request, ctx: RouteContext<"/api/early/[id]/join">) {
  try {
    const { id } = await ctx.params;
    const input = body.parse(await req.json().catch(() => null));
    const proof = "passkey" in input ? ({ kind: "passkey", assertion: input.passkey } as const) : ({ kind: "eoa", signature: input.signature as `0x${string}` } as const);
    const res = await joinEarly(await getDb(), id, input.account, proof);
    nudgeRelay("early:join");
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
