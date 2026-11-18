import { connection } from "next/server";
import { address, cosmetics, errorResponse, getDb } from "@/server/relay";

/** A player's cat cosmetics: what is unlocked, what the cat wears and the next unlock. */
export async function GET(req: Request) {
  await connection();
  try {
    const account = address.parse(new URL(req.url).searchParams.get("account")).toLowerCase();
    const p = (await cosmetics.progressOf(await getDb(), [account]))[account]!;
    return Response.json(cosmetics.cosmeticsOf(p), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
