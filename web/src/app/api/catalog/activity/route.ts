import { connection, type NextRequest } from "next/server";

const GEMINI = "https://api.gemini.com";
const cache = new Map<string, { at: number; body: unknown }>();

/**
 * How lively a contract is: Gemini's public trades of the last 24 hours (count, contracts, price
 * range in points, the last trade). Cached 60 s. Computed values only; no raw trades are passed on.
 */
export async function GET(req: NextRequest) {
  await connection();
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
  if (!/^GEMI-[A-Z0-9.-]+$/i.test(symbol)) return Response.json({ error: "symbol must be a Gemini prediction-market instrument" }, { status: 400 });
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 60_000) return Response.json(hit.body);
  const since = Date.now() - 24 * 3600_000;
  const r = await fetch(`${GEMINI}/v1/trades/${encodeURIComponent(symbol)}?limit_trades=500&timestamp=${Math.floor(since / 1000)}`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!r || !r.ok) return Response.json({ error: "Gemini did not return trades" }, { status: 502 });
  const trades = ((await r.json()) as { timestampms: number; price: string; amount: string }[]).filter((t) => t.timestampms >= since);
  const prices = trades.map((t) => Number(t.price));
  const hourAgo = Date.now() - 3600_000;
  const body = {
    symbol,
    trades24h: trades.length,
    tradesLastHour: trades.filter((t) => t.timestampms >= hourAgo).length,
    contracts24h: Math.round(trades.reduce((s, t) => s + Number(t.amount), 0)),
    rangePoints: prices.length ? Math.round((Math.max(...prices) - Math.min(...prices)) * 100) : 0,
    lastTradeMs: trades[0]?.timestampms ?? null,
    at: Date.now(),
  };
  cache.set(symbol, { at: Date.now(), body });
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
