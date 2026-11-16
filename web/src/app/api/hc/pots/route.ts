import { connection } from "next/server";
import { errorResponse, getDb, nudgeRelay, pots } from "@/server/relay";

/** Two-sided pots: all, or ?owner=0x… (either side or a pending joiner), ?state=open for unjoined offers. */
export async function GET(req: Request) {
  await connection();
  try {
    const u = new URL(req.url).searchParams;
    const owner = u.get("owner");
    const state = u.get("state");
    const list = await pots.listPotsHc(await getDb(), {
      owner: owner && /^0x[0-9a-fA-F]{40}$/.test(owner) ? owner : undefined,
      states: state === "open" ? [1] : state === "running" ? [1, 2, 3, 4] : undefined,
      limit: Math.min(Number(u.get("limit") ?? 50) || 50, 200),
    });
    nudgeRelay("hc:list");
    return Response.json({ pots: list }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
