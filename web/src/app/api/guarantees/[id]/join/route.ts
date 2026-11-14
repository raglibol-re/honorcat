import { z } from "zod";
import { address, errorResponse, getDb, joinGuarantee, nudgeRelay } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

export const maxDuration = 60;

const body = z.union([
  z.object({ account: address, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  z.object({ account: address, passkey: assertionBody }),
]);

/**
 * Enrols a customer, who proves control of `account` over "Join Verdict guarantee <id> as <account>":
 * an EOA signature (device key or browser wallet), or a passkey assertion over keccak256 of that
 * message for a passkey account. The relay pays gas for the enrolment.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/guarantees/[id]/join">) {
  try {
    const { id } = await ctx.params;
    const input = body.parse(await req.json().catch(() => null));
    const proof =
      "passkey" in input
        ? ({ kind: "passkey", assertion: input.passkey } as const)
        : ({ kind: "eoa", signature: input.signature as `0x${string}` } as const);
    const res = await joinGuarantee(await getDb(), id, input.account, proof);
    nudgeRelay("guarantees:join");
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
