import { connection, type NextRequest } from "next/server";

/**
 * Recent price of a Gemini contract from its public trade candles (GET /v2/candles/{symbol}/{tf}).
 * Trade prices only: Gemini publishes no bid/ask history, so this is a picture of recent trading,
 * not of the order-book rule that triggers payouts.
 */
export async function GET(req: NextRequest) {
  await connection();
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
  const tf = req.nextUrl.searchParams.get("tf") === "1h" ? "1h" : "5m";
  if (!/^GEMI-[A-Z0-9-]+$/i.test(symbol)) return Response.json({ error: "symbol must be a Gemini prediction-market instrument" }, { status: 400 });
  try {
    const r = await fetch(`https://api.gemini.com/v2/candles/${encodeURIComponent(symbol)}/${tf}`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!r.ok) return Response.json({ points: [], basis: "trade prices" });
    const rows = (await r.json()) as [number, number, number, number, number, number][];
    const points = rows
      .map(([t, , , , close, volume]) => ({ t, price: close, volume }))
      .sort((a, b) => a.t - b.t)
      .slice(-120);
    return Response.json({ symbol, tf, basis: "trade prices", points }, { headers: { "cache-control": "public, max-age=30" } });
  } catch {
    return Response.json({ points: [], basis: "trade prices" });
  }
}
