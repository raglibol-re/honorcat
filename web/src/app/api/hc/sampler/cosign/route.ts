import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, nudgeRelay, pots } from "@/server/relay";

const body = z.object({ signer: address, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) });

/** A sampler's co-signature of a proposal (raw ECDSA over its EIP-712 digest). */
export async function POST(req: Request) {
  await connection();
  try {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const b = body.parse(await req.json());
    const r = await pots.submitCosig(await getDb(), id, { signer: b.signer, signature: b.signature as `0x${string}` });
    nudgeRelay("hc:cosign");
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
