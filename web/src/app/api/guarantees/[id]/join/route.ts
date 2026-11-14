import { z } from "zod";
import { address, errorResponse, getDb, joinGuarantee, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({ account: address, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

/**
 * Enrols a customer. The customer proves control of `account` by signing
 * "Join Verdict guarantee <id> as <account>"; the relay pays gas for the enrolment.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/guarantees/[id]/join">) {
  try {
    const { id } = await ctx.params;
    const { account, signature } = body.parse(await req.json().catch(() => null));
    const res = await joinGuarantee(await getDb(), id, account, signature as `0x${string}`);
    nudgeRelay("guarantees:join");
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
