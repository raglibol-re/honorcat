import { connection } from "next/server";
import { errorResponse, getDb, pots } from "@/server/relay";

/** Live evidence for /how-it-is-built. */
export async function GET() {
  await connection();
  try {
    return Response.json(await pots.potsEvidence(await getDb()), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
