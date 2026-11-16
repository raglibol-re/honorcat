import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, forwardPotCall, getDb, nudgeRelay } from "@/server/relay";

const body = z.object({ data: z.string().regex(/^0x[0-9a-fA-F]+$/) });

export const maxDuration = 60;

/** Forwards a wallet-signed pot call (EIP-3009 deposit, signed exit request, handshake). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const r = await forwardPotCall(await getDb(), b.data as `0x${string}`);
    nudgeRelay("hc:forward", { samplerBudgetMs: 45_000 });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
