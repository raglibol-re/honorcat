import { connection } from "next/server";
import { errorResponse, getDb, pots, agentEvidence } from "@/server/relay";

/** Live evidence for /how-it-is-built. */
export async function GET() {
  await connection();
  try {
    const db = await getDb();
    const [ev, agents] = await Promise.all([pots.potsEvidence(db), agentEvidence(db).catch(() => null)]);
    return Response.json({ ...ev, agents }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
