import { connection } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { address, errorResponse, getConfig, getDb, nudgeRelay, pots } from "@/server/relay";

// perpD: the perp's rope distance (ppm), which sets how wide a book its price windows accept.
const body = z.object({ symbol: z.string().min(3).max(120), account: address, perpD: z.number().int().min(10_000).max(500_000).optional() });

/** The rule, conditionId, close and the v2 depth attestation (cap, spread, category) for a new rope. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const key = getConfig().samplerKey;
    const r = await pots.prepareRope(await getDb(), b, key ? privateKeyToAccount(key as `0x${string}`) : null);
    nudgeRelay("hc:prepare");
    return Response.json(r, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
