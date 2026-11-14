import { connection } from "next/server";
import { getDb, getPotDetail, integrationFrom, jsonError, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

export async function GET(req: Request, ctx: RouteContext<"/api/v1/pots/[id]">) {
  await connection();
  if (!(await integrationFrom(req))) return jsonError(401, "missing or invalid API key");
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return jsonError(400, "invalid pot id");
  const detail = await getPotDetail(await getDb(), id);
  nudgeRelay("v1:pot");
  return detail ? Response.json(detail) : jsonError(404, "pot not found (not indexed yet?)");
}
