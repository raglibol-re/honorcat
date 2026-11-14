import { z } from "zod";
import { authorizationBody, errorResponse, getDb, integrationFrom, nudgeRelay, submitGaslessFund, uint } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({ potId: uint, amount: uint, authorization: authorizationBody });

/** Relays `fundWithAuthorization`; the relay pays gas in USDC. API key optional (no per-funder limit). */
export async function POST(req: Request) {
  try {
    const { potId, amount, authorization } = body.parse(await req.json().catch(() => null));
    const me = await integrationFrom(req);
    const res = await submitGaslessFund(await getDb(), { potId, amount, auth: authorization }, me?.id ?? null);
    nudgeRelay("gasless:fund");
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
