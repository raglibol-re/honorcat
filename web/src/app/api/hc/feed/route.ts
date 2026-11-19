import { connection } from "next/server";
import { address, errorResponse, getDb, social } from "@/server/relay";

/** New pots and perps of the players ?account= follows (last 14 days). */
export async function GET(req: Request) {
  await connection();
  try {
    const a = address.parse(new URL(req.url).searchParams.get("account"));
    return Response.json({ items: await social.feedOf(await getDb(), a) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
