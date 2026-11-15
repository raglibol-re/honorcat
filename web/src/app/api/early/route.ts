import { connection } from "next/server";
import { z } from "zod";
import { authorizationBody, createEarly, errorResponse, getDb, integrationFrom, listEarly, nudgeRelay } from "@/server/relay";
import { checkEarlySeal, toEarlyTerms, type EarlyTermsJson } from "@/server/early";

export const maxDuration = 60;

/** Listed early payouts with their state. */
export async function GET() {
  await connection();
  const early = await listEarly(await getDb());
  nudgeRelay("api:early");
  return Response.json({ early });
}

const body = z.object({ terms: z.record(z.string(), z.unknown()), seal: z.string().min(10), authorization: authorizationBody });

/** Creates a funded early payout from sealed terms and the funder's EIP-3009 signature. */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => null));
    const terms = input.terms as unknown as EarlyTermsJson;
    if (!checkEarlySeal(terms, input.seal)) return Response.json({ error: "terms were changed after they were prepared" }, { status: 400 });
    const me = await integrationFrom(req);
    const res = await createEarly(await getDb(), toEarlyTerms(terms), input.authorization, me?.id ?? null);
    nudgeRelay("early:create");
    return Response.json(res, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
