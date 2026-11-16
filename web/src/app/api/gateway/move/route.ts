import { connection } from "next/server";
import { z } from "zod";
import { address, completeGatewayMove, errorResponse, getDb, prepareGatewayMove } from "@/server/relay";

export const maxDuration = 60;

const prepare = z.object({ action: z.literal("prepare"), sourceDomain: z.number().int().min(0).max(100), depositor: address, recipient: address, value: z.string().regex(/^\d+$/) });
const complete = z.object({ action: z.literal("complete"), burnIntent: z.record(z.string(), z.unknown()), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

/**
 * Moves USDC from a Circle Gateway balance (deposited on any supported chain) to an account on Arc.
 * "prepare": the BurnIntent to sign, with Circle's fee estimate. "complete": the signed intent;
 * Circle attests, and HonorCat's relay mints on Arc.
 */
export async function POST(req: Request) {
  await connection();
  try {
    const raw = await req.json();
    if (raw?.action === "prepare") {
      const b = prepare.parse(raw);
      return Response.json(await prepareGatewayMove({ sourceDomain: b.sourceDomain, depositor: b.depositor, recipient: b.recipient, value: BigInt(b.value) }));
    }
    const b = complete.parse(raw);
    return Response.json(await completeGatewayMove(await getDb(), { burnIntent: b.burnIntent, signature: b.signature as `0x${string}` }));
  } catch (err) {
    return errorResponse(err);
  }
}
