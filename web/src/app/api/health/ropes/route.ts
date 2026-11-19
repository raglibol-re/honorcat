import { connection } from "next/server";
import { errorResponse, getDb, pots } from "@/server/relay";

/**
 * Short ropes running more than 150 s past their end (no agreed end price yet): 200 when none,
 * 503 otherwise. Point an uptime monitor here to be alerted when ropes are stuck.
 */
export async function GET() {
  await connection();
  try {
    const h = await pots.delayedRopes(await getDb());
    return Response.json(h, { status: h.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
