import { connection, type NextRequest } from "next/server";
import { getDb, streamsOverview } from "@/server/relay";

/** Recent QuickNode Streams deliveries, latency stats and which path indexed each event first. */
export async function GET(req: NextRequest) {
  await connection();
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0);
  return Response.json(await streamsOverview(await getDb(), { since: Number.isFinite(since) ? since : 0 }));
}
