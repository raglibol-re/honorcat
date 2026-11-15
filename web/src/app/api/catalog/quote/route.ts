import { connection, type NextRequest } from "next/server";
import { liveQuality } from "@/server/catalog";
import { getDb } from "@/server/relay";

/** One contract's order book now (cached 5 s): best prices, sizes, depth, quality. */
export async function GET(req: NextRequest) {
  await connection();
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
  if (!/^GEMI-[A-Z0-9.-]+$/i.test(symbol)) return Response.json({ error: "symbol must be a Gemini prediction-market instrument" }, { status: 400 });
  const r = await liveQuality(await getDb(), symbol);
  if (!r.book) return Response.json({ error: "Gemini did not return this order book" }, { status: 502 });
  const mid = r.book.bid !== null && r.book.ask !== null ? (r.book.bid + r.book.ask) / 2 : null;
  return Response.json({ symbol, ...r.book, mid, quality: r.quality }, { headers: { "cache-control": "no-store" } });
}
