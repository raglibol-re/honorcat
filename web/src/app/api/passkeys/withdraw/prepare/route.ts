import { z } from "zod";
import { address, errorResponse, getDb, preparePasskeyWithdraw, uint } from "@/server/relay";

const body = z.object({ account: address, to: address, value: uint });

/** The challenge a passkey signs to send USDC from its account (PasskeyAccount.execute). */
export async function POST(req: Request) {
  try {
    const { account, to, value } = body.parse(await req.json().catch(() => null));
    return Response.json(await preparePasskeyWithdraw(await getDb(), account, to, value));
  } catch (err) {
    return errorResponse(err);
  }
}
