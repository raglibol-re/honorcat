import { connection } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { address, errorResponse, getConfig, getDb, groups, nudgeRelay } from "@/server/relay";

const body = z.object({ symbol: z.string().min(3).max(120), account: address });

/** The rule, conditionId, close and the depth attestation (the cap) for a new group. */
export async function POST(req: Request) {
  await connection();
  try {
    if (!groups.groupsStatus().on) return Response.json({ error: "group pots are not switched on" }, { status: 409 });
    const b = body.parse(await req.json());
    const key = getConfig().samplerKey;
    const r = await groups.prepareGroup(await getDb(), b, key ? privateKeyToAccount(key as `0x${string}`) : null);
    nudgeRelay("hc:prepare");
    return Response.json(r, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
