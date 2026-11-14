import { connection, type NextRequest } from "next/server";
import { getDb, integrationFrom, jsonError, listPots, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

/** Pots, optionally filtered by `conditionId` or `status`. */
export async function GET(req: NextRequest) {
  await connection();
  if (!(await integrationFrom(req))) return jsonError(401, "missing or invalid API key");
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? undefined;
  if (status && !["open", "resolved", "expired"].includes(status)) return jsonError(400, "invalid status");
  const conditionId = sp.get("conditionId")?.toLowerCase();
  const pots = await listPots(await getDb(), { status, limit: Number(sp.get("limit") ?? 100) });
  nudgeRelay("v1:pots");
  return Response.json({ pots: conditionId ? pots.filter((p) => p.conditionId.toLowerCase() === conditionId) : pots });
}
