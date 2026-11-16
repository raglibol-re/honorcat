import { connection } from "next/server";
import { errorResponse, getDb, pots } from "@/server/relay";

/**
 * Sampler health: 200 when at least the threshold of samplers (2 of 3) asked for work in the last
 * two minutes, 503 otherwise. Point an uptime monitor here to be alerted when prices cannot be agreed.
 */
export async function GET() {
  await connection();
  try {
    const h = await pots.samplersHealth(await getDb());
    return Response.json(h, { status: h.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
