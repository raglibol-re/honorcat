import { connection, type NextRequest } from "next/server";
import { listActiveEvents } from "@/server/gemini";
import { toMarket } from "@/server/guarantees";

const CATEGORIES = ["Crypto", "Weather", "Economics", "Commodities", "Sports", "Politics", "Culture"];

/**
 * Every active Gemini contract in a category, for early payouts (any market works). Markets that
 * close within ~4 minutes are left out: there would be no time to join and fill one window.
 */
export async function GET(req: NextRequest) {
  await connection();
  const category = req.nextUrl.searchParams.get("category") ?? "Crypto";
  if (!CATEGORIES.includes(category)) return Response.json({ error: `category must be one of ${CATEGORIES.join(", ")}` }, { status: 400 });
  try {
    const now = Date.now();
    const events = await listActiveEvents(category, 200);
    const markets = events
      .filter((e) => e.status === "active" && e.expiryDate && new Date(e.expiryDate).getTime() > now + 4 * 60_000)
      .sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""))
      .slice(0, 80)
      .map(toMarket)
      .filter((m) => m.contracts.length > 0);
    return Response.json({ category, categories: CATEGORIES, markets, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json({ error: `Gemini is unavailable: ${(err as Error).message}` }, { status: 502 });
  }
}
