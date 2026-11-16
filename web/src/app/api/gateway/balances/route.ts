import { connection } from "next/server";
import { errorResponse, gatewayBalances } from "@/server/relay";

/** A depositor's Circle Gateway USDC balance on each supported chain (finalized deposits). */
export async function GET(req: Request) {
  await connection();
  try {
    const d = new URL(req.url).searchParams.get("depositor") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(d)) return Response.json({ error: "depositor=0x… required" }, { status: 400 });
    return Response.json({ balances: await gatewayBalances(d as `0x${string}`) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
