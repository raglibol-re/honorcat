import { connection } from "next/server";
import { errorResponse, getDb, pots } from "@/server/relay";

/**
 * A pot's price over time, from Gemini's public candles for its contract (the close of each candle,
 * 0..1), from the pot's creation to now or to the close. The pot page marks the entry, every exit
 * and the settlement on it. Data provided by Gemini.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    const d = await pots.potDetail(await getDb(), id);
    if (!d?.market) return Response.json({ points: [] }, { headers: { "cache-control": "no-store" } });
    const created = (d.events ?? []).find((e: { name: string }) => e.name === "PotCreated") as { at: number | null } | undefined;
    const fromMs = (created?.at ?? Math.floor(Date.now() / 1000) - 3600) * 1000;
    const endMs = Math.min(Date.now(), Number(d.data.closeTime) * 1000 + 3600_000);
    const span = endMs - fromMs;
    const tf = span < 3 * 3600_000 ? "1m" : span < 2 * 86_400_000 ? "5m" : "1hr";
    const r = await fetch(`https://api.gemini.com/v2/candles/${encodeURIComponent(d.market.instrument)}/${tf}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const raw = r.ok ? ((await r.json()) as [number, number, number, number, number, number][]) : [];
    const points = raw
      .filter((c) => c[0] >= fromMs - 5 * 60_000 && c[0] <= endMs)
      .map((c) => ({ t: c[0], p: c[4] }))
      .sort((a, b) => a.t - b.t);
    return Response.json({ points, timeframe: tf, fromMs, endMs }, { headers: { "cache-control": "public, max-age=30" } });
  } catch (err) {
    return errorResponse(err);
  }
}
