import { connection } from "next/server";
import { address, errorResponse, getDb, posts } from "@/server/relay";

/** The pots, perps and groups ?account= holds a side in (last 30 days), to post about. */
export async function GET(req: Request) {
  await connection();
  try {
    if (!posts.socialOn()) return Response.json({ plays: [] });
    const a = address.parse(new URL(req.url).searchParams.get("account"));
    return Response.json({ plays: await posts.postablePlays(await getDb(), a) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
