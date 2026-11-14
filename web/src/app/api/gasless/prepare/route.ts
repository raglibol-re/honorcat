import { z } from "zod";
import { address, errorResponse, potParamsBody, prepareGasless, uint } from "@/server/relay";

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fund"), potId: uint, from: address, amount: uint }),
  z.object({ kind: z.literal("create"), params: potParamsBody, from: address, amount: uint }),
]);

/**
 * Returns the EIP-712 typed data (Arc USDC `ReceiveWithAuthorization`) the funder signs, with a
 * nonce bound to the pot or to the full pot parameters. Nothing is stored; the client keeps
 * `salt`, `validAfter` and `validBefore` and sends them back with the signature.
 */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => null));
    const prepared = await prepareGasless(input);
    // bigint -> string for JSON
    return new Response(JSON.stringify(prepared, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
