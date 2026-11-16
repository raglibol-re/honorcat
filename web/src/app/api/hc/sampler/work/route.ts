import { connection } from "next/server";
import { errorResponse, getDb, nudgeRelay, pots } from "@/server/relay";

/** What a pot sampler should do now: windows to measure, proposals to co-sign, levels to watch. Public. */
export async function GET(req: Request) {
  await connection();
  try {
    const signer = new URL(req.url).searchParams.get("signer") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(signer)) return Response.json({ error: "signer=0x... required" }, { status: 400 });
    const work = await pots.potsWork(await getDb(), signer as `0x${string}`);
    nudgeRelay("hc:work");
    return Response.json(work, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
