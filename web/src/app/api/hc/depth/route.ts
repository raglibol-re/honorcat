import { connection } from "next/server";
import { errorResponse, getDb, nudgeRelay, pots } from "@/server/relay";

/** The depth attestation and, once two samplers signed, the signatures. Poll after /prepare. */
export async function GET(req: Request) {
  await connection();
  try {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const r = await pots.depthResult(await getDb(), id);
    if (!r) return Response.json({ error: "unknown depth request" }, { status: 404 });
    if (!r.signatures) nudgeRelay("hc:depth");
    return Response.json(r, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
