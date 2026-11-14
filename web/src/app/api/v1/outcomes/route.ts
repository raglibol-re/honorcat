import { z } from "zod";
import { ApiSource, errorResponse, getDb, hex32, integrationFrom, jsonError, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({ conditionId: hex32, outcome: z.boolean() });

/**
 * Reports the final outcome of one of the calling integration's `api` conditions. Idempotent;
 * an outcome cannot be changed once reported (409). The relay signs and settles on the next
 * tick, which this request triggers.
 */
export async function POST(req: Request) {
  const me = await integrationFrom(req);
  if (!me) return jsonError(401, "missing or invalid API key");
  try {
    const { conditionId, outcome } = body.parse(await req.json().catch(() => null));
    const res = await new ApiSource(await getDb()).report(conditionId, outcome, me.id);
    nudgeRelay("v1:outcome");
    return Response.json({ conditionId, ...res });
  } catch (err) {
    return errorResponse(err);
  }
}
