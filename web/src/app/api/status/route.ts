import { connection } from "next/server";
import { getDb, nudgeRelay, relayStatus } from "@/server/relay";

export const maxDuration = 60;

/** Public operational status: resolver USDC balance, gas spent in USDC, runway, indexer lag. */
export async function GET() {
  await connection();
  const status = await relayStatus(await getDb());
  nudgeRelay("api:status");
  return Response.json(status);
}
