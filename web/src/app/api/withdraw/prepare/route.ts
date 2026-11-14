import { z } from "zod";
import { address, errorResponse, prepareWithdraw, uint } from "@/server/relay";

const body = z.object({ from: address, to: address, value: uint });

/** EIP-3009 TransferWithAuthorization typed data (Arc USDC) for a gasless withdrawal. */
export async function POST(req: Request) {
  try {
    const { from, to, value } = body.parse(await req.json().catch(() => null));
    const prepared = await prepareWithdraw(from, to, value);
    return new Response(JSON.stringify(prepared, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
