import { connection } from "next/server";
import { errorResponse, getDb, poolStatus } from "@/server/relay";

/** The test-money pool: balance, given today, how it refills, the last refill. */
export async function GET() {
  await connection();
  try {
    return Response.json(await poolStatus(await getDb()), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
