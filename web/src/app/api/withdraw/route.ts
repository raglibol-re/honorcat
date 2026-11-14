import { z } from "zod";
import { address, errorResponse, getDb, hex32, submitWithdraw, uint } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({
  from: address,
  to: address,
  value: uint,
  validAfter: uint,
  validBefore: uint,
  nonce: hex32,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  guaranteeId: z.string().max(20).optional(),
});

/** Relays a customer's signed USDC transfer; the relay pays gas. Enrolled customers only. */
export async function POST(req: Request) {
  try {
    const w = body.parse(await req.json().catch(() => null));
    const res = await submitWithdraw(await getDb(), { ...w, signature: w.signature as `0x${string}` });
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
