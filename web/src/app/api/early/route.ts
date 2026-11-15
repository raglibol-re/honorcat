import { connection } from "next/server";
import { getDb, listEarly, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

/** Listed early payouts with their state. Read-only: early payouts are retired, none can be created. */
export async function GET() {
  await connection();
  const early = await listEarly(await getDb());
  nudgeRelay("api:early");
  return Response.json({ early });
}
