import { errorResponse, prepareDrop } from "@/server/relay";
import { dropBody, dropTermsFrom, json } from "@/server/drops";

export const maxDuration = 30;

/**
 * Builds the Merkle tree for the list, binds it to a live Gemini contract and returns the
 * EIP-3009 typed data the funder signs for the total. The response's `entropy` and
 * `terms.lockTime` go back to POST /api/drops with the signature.
 */
export async function POST(req: Request) {
  try {
    const input = dropBody.parse(await req.json().catch(() => null));
    const terms = await dropTermsFrom(input);
    const p = await prepareDrop(terms);
    return json({
      terms: { ...terms, entries: terms.entries.length },
      root: p.root,
      amount: p.amount,
      entropy: p.entropy,
      ...p.prepared,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
