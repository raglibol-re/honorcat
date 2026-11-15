import { z } from "zod";
import { address, errorResponse, getDb, submitEarlySamples } from "@/server/relay";

const body = z.object({
  signer: address,
  samples: z.array(z.object({ t: z.number().int(), mid: z.number().min(0).max(1).nullable(), status: z.number().int().min(0).max(7) })).max(500),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/** Recent samples from a sampler, signed by it, for the live chart. Decisions use evidence records only. */
export async function POST(req: Request, ctx: RouteContext<"/api/early/[id]/samples">) {
  try {
    const { id } = await ctx.params;
    const input = body.parse(await req.json().catch(() => null));
    return Response.json(await submitEarlySamples(await getDb(), id, input.signer, input.samples, input.signature as `0x${string}`));
  } catch (err) {
    return errorResponse(err);
  }
}
