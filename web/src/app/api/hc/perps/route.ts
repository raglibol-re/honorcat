import { connection } from "next/server";
import { errorResponse, getDb, nudgeRelay, perps } from "@/server/relay";

/** Perps: all, or ?owner=0x… (either player), ?state=open for offers waiting for a second player, live (both in), ended. */
export async function GET(req: Request) {
  await connection();
  try {
    const u = new URL(req.url).searchParams;
    const owner = u.get("owner");
    const state = u.get("state");
    const list = await perps.listPerps(await getDb(), {
      owner: owner && /^0x[0-9a-fA-F]{40}$/.test(owner) ? owner : undefined,
      phases: state === "open" ? [1] : state === "running" ? [1, 2, 3, 4] : state === "live" ? [2, 3, 4] : state === "ended" ? [5] : undefined,
      limit: Math.min(Number(u.get("limit") ?? 50) || 50, 200),
    });
    nudgeRelay("hc:perps");
    return Response.json({ perps: list }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
