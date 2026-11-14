import { z } from "zod";
import { address, errorResponse, getDb, submitPasskeyWithdraw, uint } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

export const maxDuration = 60;

const body = z.object({
  account: address,
  to: address,
  value: uint,
  deadline: uint,
  assertion: assertionBody,
  guaranteeId: z.string().max(20).optional(),
});

/** Deploys the passkey account if needed and sends the authorised transfer; HonorCat pays gas. */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => null));
    return Response.json(await submitPasskeyWithdraw(await getDb(), input));
  } catch (err) {
    return errorResponse(err);
  }
}
