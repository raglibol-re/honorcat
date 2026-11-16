import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, topUp } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({ account: address, need: z.string().regex(/^\d+$/) });

/** Tops an account up to cover a deposit (testnet; per-account and daily limits). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    return Response.json(await topUp(await getDb(), b.account, BigInt(b.need)));
  } catch (err) {
    return errorResponse(err);
  }
}
