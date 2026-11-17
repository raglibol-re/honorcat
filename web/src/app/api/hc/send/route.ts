import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, submitSend, uint } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const body = z.object({
  account: address,
  to: address,
  value: uint,
  deadline: uint,
  assertion: assertionBody,
  potId: z.string().regex(/^\d{1,12}$/).optional(),
});

export const maxDuration = 60;

/** Sends passkey-signed test USDC to a player or a wallet; HonorCat pays the network fee. */
export async function POST(req: Request) {
  await connection();
  try {
    const input = body.parse(await req.json().catch(() => null));
    return Response.json(await submitSend(await getDb(), input));
  } catch (err) {
    return errorResponse(err);
  }
}
