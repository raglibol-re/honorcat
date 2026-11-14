import { connection, type NextRequest } from "next/server";
import { getDb, getPotDetail, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/pots/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const potId = Number(id);
  if (!Number.isSafeInteger(potId) || potId < 1) return Response.json({ error: "invalid pot id" }, { status: 400 });
  nudgeRelay("api:pot");
  const detail = await getPotDetail(await getDb(), potId);
  if (!detail) return Response.json({ error: "pot not found (not indexed yet?)" }, { status: 404 });
  return Response.json(detail);
}
