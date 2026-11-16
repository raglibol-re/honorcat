import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, preparePasskeyPotCall } from "@/server/relay";

const body = z.object({ account: address, data: z.string().regex(/^0x[0-9a-fA-F]+$/), spend: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).default("0") });

/** The passkey challenges for a pot call (plus an approval when the allowance is short). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    return Response.json(await preparePasskeyPotCall(await getDb(), b.account, b.data as `0x${string}`, BigInt(b.spend)), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
