import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, prepareSend, uint } from "@/server/relay";

const body = z.object({ account: address, to: address, value: uint });

/** The challenge a passkey signs to send test USDC to another player or to a wallet. */
export async function POST(req: Request) {
  await connection();
  try {
    const { account, to, value } = body.parse(await req.json().catch(() => null));
    return Response.json(await prepareSend(await getDb(), account, to, value), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
