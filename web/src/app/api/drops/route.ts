import { connection } from "next/server";
import { z } from "zod";
import { authorizationBody, createDrop, errorResponse, getDb, hex32, integrationFrom, listDrops, nudgeRelay } from "@/server/relay";
import { dropBody, dropTermsFrom, json } from "@/server/drops";

export const maxDuration = 60;

/** Listed drops with payee count, amount claimed and pot status. */
export async function GET() {
  await connection();
  const drops = await listDrops(await getDb());
  nudgeRelay("api:drops");
  return json({ drops });
}

const body = dropBody.extend({ lockTime: z.number().int(), entropy: hex32, authorization: authorizationBody });

/**
 * Creates a funded drop: one pot paying MerkleBook, the list's root, and the funder's EIP-3009
 * signature (whose salt commits to the root). Send the same entries and lockTime as /prepare.
 */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => null));
    const terms = await dropTermsFrom(input);
    const me = await integrationFrom(req);
    const res = await createDrop(await getDb(), terms, input.authorization, input.entropy, me?.id ?? null);
    nudgeRelay("drops:create");
    return json(res, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
