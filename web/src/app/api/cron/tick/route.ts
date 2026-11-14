import { connection } from "next/server";
import { getConfig, hasBearer, runTick } from "@/server/relay";

export const maxDuration = 60;

/**
 * Scheduled relay step. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 * The same route can be called by any external scheduler holding the secret.
 */
export async function GET(req: Request) {
  await connection();
  if (!hasBearer(req, getConfig().cronSecret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const report = await runTick({ reason: "cron", force: true });
  return Response.json(report);
}
