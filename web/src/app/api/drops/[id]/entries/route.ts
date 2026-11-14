import { errorResponse, getConfig, getDb, hasBearer, jsonError, replaceDropEntries, nudgeRelay } from "@/server/relay";
import { entriesBody, json } from "@/server/drops";
import { z } from "zod";

export const maxDuration = 60;

/**
 * Replaces the list before its lock time (admin). On-chain this is MerkleBook.setRoot, which
 * emits RootSet with a new version; the funder can also call setRoot directly.
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/drops/[id]/entries">) {
  if (!hasBearer(req, getConfig().adminToken)) return jsonError(401, "unauthorized");
  try {
    const { id } = await ctx.params;
    const { entries } = z.object({ entries: entriesBody }).parse(await req.json().catch(() => null));
    const res = await replaceDropEntries(await getDb(), id, entries);
    nudgeRelay("drops:root");
    return json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
