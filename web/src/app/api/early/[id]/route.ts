import { connection } from "next/server";
import { earlyDetail, getDb, nudgeRelay } from "@/server/relay";
import { getEvent, impliedChance } from "@/server/gemini";
import { publicDetail } from "@/server/evidence";

export const maxDuration = 60;

/**
 * One early payout: terms, state, recipients, payments, each sampler's evidence hash with its
 * computed values (window, average, counts, decision) and the chance averaged per 5 s for the chart,
 * plus the live Gemini price (marked as an estimate). Raw readings: /api/early/{id}/evidence.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/early/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const d = await earlyDetail(await getDb(), id);
  if (!d) return Response.json({ error: "early payout not found" }, { status: 404 });
  nudgeRelay("api:early-detail");
  const ev = await getEvent(d.early.eventTicker).catch(() => null);
  const c = ev?.contracts.find((x) => x.ticker === d.early.contractTicker);
  const yes = c ? impliedChance(c.prices) : null;
  const market = c
    ? {
        estimate: true as const,
        status: c.status,
        marketState: c.marketState ?? null,
        resolutionSide: c.resolutionSide ?? null,
        chance: yes === null ? null : d.early.side === "yes" ? yes : 1 - yes,
        image: (ev as { imageUrl?: string | null }).imageUrl ?? null,
      }
    : null;
  return Response.json({ ...publicDetail(d), market }, { headers: { "cache-control": "no-store" } });
}
