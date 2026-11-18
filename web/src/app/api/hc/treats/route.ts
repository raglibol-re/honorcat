import { connection } from "next/server";
import { address, errorResponse, getDb, treats } from "@/server/relay";

/** An account's treats (maker treats, exit fees, referral shares, copycat treats), each with its transaction. */
export async function GET(req: Request) {
  await connection();
  try {
    const account = address.parse(new URL(req.url).searchParams.get("account"));
    return Response.json(await treats.treatsOf(await getDb(), account), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
