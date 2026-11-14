import { connection } from "next/server";
import { z } from "zod";
import { authorizationBody, createGuarantee, errorResponse, getDb, integrationFrom, listGuarantees, nudgeRelay } from "@/server/relay";
import { checkSeal, toTerms, type TermsJson } from "@/server/terms";

export const maxDuration = 60;

/** All guarantees with enrolment count, locked amount, status and outcome. */
export async function GET() {
  await connection();
  const guarantees = await listGuarantees(await getDb());
  nudgeRelay("api:guarantees");
  return Response.json({ guarantees });
}

const body = z.object({
  terms: z.record(z.string(), z.unknown()),
  seal: z.string().min(10),
  authorization: authorizationBody,
});

/** Creates a funded guarantee from sealed terms and the merchant's EIP-3009 signature. */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => null));
    const terms = input.terms as unknown as TermsJson;
    if (!checkSeal(terms, input.seal)) return Response.json({ error: "terms were changed after they were prepared" }, { status: 400 });
    const me = await integrationFrom(req);
    const res = await createGuarantee(await getDb(), toTerms(terms), input.authorization, me?.id ?? null);
    nudgeRelay("guarantees:create");
    return Response.json(res, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
