import { after, connection, type NextRequest } from "next/server";
import { catalogList, catalogTick } from "@/server/catalog";
import { getDb } from "@/server/relay";

/**
 * Every active Gemini contract with its quality under the rule its pot would get, sorted works
 * first. Filters: category, within (hours to close), q (words in title/label), usable=1.
 * Refreshes itself in the background (also driven by the Streams webhook).
 */
export async function GET(req: NextRequest) {
  await connection();
  const p = req.nextUrl.searchParams;
  const db = await getDb();
  const res = await catalogList(db, {
    category: p.get("category"),
    withinH: p.get("within") ? Number(p.get("within")) : null,
    q: p.get("q"),
    usable: p.get("usable") === "1",
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    offset: p.get("offset") ? Number(p.get("offset")) : undefined,
  });
  after(async () => {
    await catalogTick(await getDb()).catch((e) => console.error("[catalog] step", e));
  });
  return Response.json(res, { headers: { "cache-control": "no-store" } });
}
