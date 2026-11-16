import { connection } from "next/server";
import { z } from "zod";
import { address, dripTestUsdc, errorResponse, getDb } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({ account: address });

/** Sends a new account 2 test USDC, once per account, within a daily budget (testnet only). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const r = await dripTestUsdc(await getDb(), b.account);
    return Response.json(r, { status: r.sent ? 200 : 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
