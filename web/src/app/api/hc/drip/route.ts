import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, welcome } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({ account: address });

/** Welcome test money for an account on its first sign-in (once per account, budgeted; testnet). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const r = await welcome(await getDb(), b.account);
    return Response.json(r, { status: r.sent || r.reason === "already welcomed" ? 200 : 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
