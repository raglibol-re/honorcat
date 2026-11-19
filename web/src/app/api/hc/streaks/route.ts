import { connection } from "next/server";
import { address, errorResponse, getDb, social } from "@/server/relay";

/** ?account=: playing streak (consecutive days) and plays in the last three hours (break reminder). */
export async function GET(req: Request) {
  await connection();
  try {
    const a = address.parse(new URL(req.url).searchParams.get("account"));
    const db = await getDb();
    const s = (await social.streaksOf(db, [a]))[a.toLowerCase()] ?? { current: 0, best: 0, days: 0 };
    const r = await social.recentPlays(db, a);
    return Response.json({ ...s, lastThreeHours: r.lastThreeHours }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
