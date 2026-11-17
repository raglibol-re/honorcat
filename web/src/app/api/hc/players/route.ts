import { connection } from "next/server";
import { errorResponse, findPlayers, getDb } from "@/server/relay";

/** Players by display name (or one by address), each with its cat's fur, to pick whom to send to. */
export async function GET(req: Request) {
  await connection();
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 64);
    return Response.json({ players: await findPlayers(await getDb(), q) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
