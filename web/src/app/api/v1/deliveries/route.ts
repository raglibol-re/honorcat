import { connection } from "next/server";
import { getDb, integrationFrom, jsonError, listDeliveries } from "@/server/relay";

/** Recent webhook deliveries for the calling integration (status, attempts, last error). */
export async function GET(req: Request) {
  await connection();
  const me = await integrationFrom(req);
  if (!me) return jsonError(401, "missing or invalid API key");
  return Response.json({ deliveries: await listDeliveries(await getDb(), me.id) });
}
