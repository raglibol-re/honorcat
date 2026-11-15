import { connection } from "next/server";
import { armedPots, getDb, nudgeRelay } from "@/server/relay";

/**
 * Early-payout pots samplers must watch. Public: samplers do not trust it for the rule; each one
 * recomputes the conditionId from the parameters and checks the pot on-chain before watching.
 * `?signer=0x…` adds which results that sampler has already submitted.
 */
export async function GET(req: Request) {
  await connection();
  const signer = new URL(req.url).searchParams.get("signer");
  const pots = await armedPots(await getDb(), signer && /^0x[0-9a-fA-F]{40}$/.test(signer) ? (signer as `0x${string}`) : undefined);
  nudgeRelay("early:armed");
  return Response.json({ pots }, { headers: { "cache-control": "no-store" } });
}
