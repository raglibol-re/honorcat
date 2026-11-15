import { z } from "zod";
import { address, errorResponse, getDb, nudgeRelay, submitEarlySignature, type SamplerSubmission } from "@/server/relay";

export const maxDuration = 60;

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const body = z.union([
  z.object({ kind: z.literal("trigger"), record: z.record(z.string(), z.unknown()), attestation: hex, resolution: hex }),
  z.object({
    kind: z.enum(["close", "void", "settle"]),
    signer: address,
    outcome: z.boolean(),
    resolution: hex,
    reason: z.string().max(300),
    observed: z.record(z.string(), z.unknown()),
  }),
]);

/**
 * A sampler submits its signed result. Every submission is checked in full (authorised sampler,
 * signatures, and for a trigger the evidence record against its own rule) before it is stored.
 * The relay settles once two of three samplers agree.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/early/[id]/sign">) {
  try {
    const { id } = await ctx.params;
    const input = body.parse(await req.json().catch(() => null)) as SamplerSubmission;
    const res = await submitEarlySignature(await getDb(), id, input);
    nudgeRelay("early:sign");
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
