import { connection, type NextRequest } from "next/server";

/**
 * One-minute price candles from Gemini for a prediction-market contract, from `since` (unix
 * seconds, at most 12 hours back): [time s, close]. Gemini builds them from trades, so a quiet
 * market shows its last trade, not the middle of the book the ropes use. Cached 30 s per contract.
 */
const cache = new Map<string, { at: number; rows: [number, number][] }>();

export async function GET(req: NextRequest) {
  await connection();
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
  if (!/^GEMI-[A-Z0-9.-]+$/i.test(symbol)) return Response.json({ error: "symbol must be a Gemini prediction-market instrument" }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  const since = Math.max(now - 12 * 3600, Number(req.nextUrl.searchParams.get("since")) || now - 3600);
  let hit = cache.get(symbol);
  if (!hit || Date.now() - hit.at > 30_000) {
    const r = await fetch(`https://api.gemini.com/v2/candles/${encodeURIComponent(symbol)}/1m`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
    if (!r?.ok) return Response.json({ error: "Gemini did not return the price history" }, { status: 502 });
    const raw = (await r.json()) as [number, number, number, number, number, number][];
    hit = { at: Date.now(), rows: raw.map((c) => [Math.floor(c[0] / 1000), c[4]] as [number, number]).sort((a, b) => a[0] - b[0]) };
    cache.set(symbol, hit);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  const rows = hit.rows.filter((c) => c[0] >= since - 60);
  return Response.json({ symbol, candles: rows }, { headers: { "cache-control": "no-store" } });
}
