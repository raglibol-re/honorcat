import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, nudgeRelay, submitPasskeyPotCall } from "@/server/relay";

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((s) => s as `0x${string}`);
const assertion = z.object({
  authenticatorData: hex,
  clientDataJSON: z.string().max(4000),
  challengeIndex: z.number().int().nonnegative(),
  typeIndex: z.number().int().nonnegative(),
  r: hex,
  s: hex,
});
const body = z.object({
  account: address,
  steps: z.array(z.object({ target: address, data: hex, deadline: z.string().regex(/^\d+$/), nonce: z.string().regex(/^\d+$/), assertion })).min(1).max(3),
});

export const maxDuration = 60;

/** Runs passkey-signed pot calls; HonorCat pays the fee. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const r = await submitPasskeyPotCall(await getDb(), b);
    nudgeRelay("hc:passkey", { samplerBudgetMs: 45_000 });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
