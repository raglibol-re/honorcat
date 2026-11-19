import { connection } from "next/server";
import { address, errorResponse, getDb, honorRoots } from "@/server/relay";

/** ?account=0x…[&day=N]: that player's Merkle proof for the day's honor root (newest by default). */
export async function GET(req: Request) {
  await connection();
  try {
    const q = new URL(req.url).searchParams;
    const a = address.parse(q.get("account"));
    const d = q.get("day");
    const r = await honorRoots.honorProof(await getDb(), a, d && /^\d+$/.test(d) ? Number(d) : undefined);
    if (!r) return Response.json({ error: "no honor root yet" }, { status: 404 });
    return Response.json(r, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (err) {
    return errorResponse(err);
  }
}
