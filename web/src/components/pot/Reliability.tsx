"use client";

import { C } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";

type Quote = { bid: number | null; ask: number | null; bidDepth: number; askDepth: number };
type Activity = { trades24h: number; tradesLastHour: number; contracts24h: number; rangePoints: number; lastTradeMs: number | null };

/**
 * How reliable this market's price is, in plain words, before anyone commits: the gap between
 * buy and sell, how much is offered near the price, and how often it trades and moves.
 */
export function Reliability({ symbol }: { symbol: string }) {
  const q = usePolling<Quote>(`/api/catalog/quote?symbol=${encodeURIComponent(symbol)}`, 15_000).data;
  const a = usePolling<Activity>(`/api/catalog/activity?symbol=${encodeURIComponent(symbol)}`, 60_000).data;
  if (!q) return null;
  const spread = q.bid !== null && q.ask !== null ? Math.round((q.ask - q.bid) * 100) : null;
  const depth = Math.round(Math.min(q.bidDepth, q.askDepth));
  const notes: string[] = [];
  let good = true;
  if (spread === null) {
    notes.push("Only one side of the book has offers: the price cannot be measured.");
    good = false;
  } else if (spread <= 1) notes.push(`Buy and sell are ${spread} cent apart: a tight market.`);
  else if (spread <= 3) notes.push(`Buy and sell are ${spread} cents apart: the price moves in steps of about a point.`);
  else {
    notes.push(`Buy and sell are ${spread} cents apart: a wide market; many readings will not count.`);
    good = false;
  }
  if (depth < 20) {
    notes.push(`Only ${depth} contracts are offered near the price on the thinner side: easy to move.`);
    good = false;
  } else notes.push(`${depth} contracts are offered within 5 cents of the price on the thinner side.`);
  if (a) {
    if (a.trades24h === 0) notes.push("No trades in the last day: the price may sit still or jump.");
    else notes.push(`${a.trades24h} trades in the last day (${a.tradesLastHour} in the last hour); the price ranged over ${a.rangePoints} points.`);
  }
  return (
    <div style={{ borderLeft: `3px solid ${good ? C.ink : C.signal}`, padding: "4px 0 4px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
      <strong style={{ fontSize: 16 }}>{good ? "A reliable price to play on" : "A shaky price: think twice"}</strong>
      {notes.map((n) => (
        <span key={n} style={{ fontSize: 15, color: C.body }}>
          {n}
        </span>
      ))}
      <span style={{ fontSize: 13, color: C.muted }}>Data provided by Gemini.</span>
    </div>
  );
}
