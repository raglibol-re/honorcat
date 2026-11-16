"use client";

import { useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/api";

export type PricePoint = { t: number; mid: number };
export type LivePrice = {
  /** Latest Gemini midpoint (YES), 0..1. */
  mid: number | null;
  /** Time-weighted average of the midpoints over the last `windowS` seconds: what the shares use. */
  smoothed: number | null;
  /** Recent smoothed values for the paw path. */
  trail: PricePoint[];
  /** Absolute move of the smoothed price over the last 10 s, in points. */
  speed: number;
  at: number | null;
  error: string | null;
};

/**
 * The live price of a pot's market, read from Gemini's order book every 2 s and smoothed over the
 * pot's window (30 s), like the samplers do. The shares shown follow the smoothed price, never a
 * single tick.
 */
export function useLivePrice(symbol: string | null | undefined, windowS = 30): LivePrice {
  const [state, setState] = useState<LivePrice>({ mid: null, smoothed: null, trail: [], speed: 0, at: null, error: null });
  const points = useRef<PricePoint[]>([]);
  const trail = useRef<PricePoint[]>([]);

  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    points.current = [];
    trail.current = [];
    const tick = async () => {
      try {
        const q = await getJson<{ mid: number | null; at: number }>(`/api/catalog/quote?symbol=${encodeURIComponent(symbol)}`);
        if (!alive) return;
        const now = Date.now();
        if (q.mid !== null) points.current.push({ t: now, mid: q.mid });
        points.current = points.current.filter((p) => p.t > now - windowS * 1000);
        const pts = points.current;
        let smoothed: number | null = null;
        if (pts.length === 1) smoothed = pts[0]!.mid;
        else if (pts.length > 1) {
          // time-weighted: each point holds until the next one
          let area = 0;
          let span = 0;
          for (let i = 0; i < pts.length; i++) {
            const dt = (i + 1 < pts.length ? pts[i + 1]!.t : now) - pts[i]!.t;
            area += pts[i]!.mid * Math.max(dt, 1);
            span += Math.max(dt, 1);
          }
          smoothed = area / span;
        }
        if (smoothed !== null) {
          trail.current.push({ t: now, mid: smoothed });
          trail.current = trail.current.filter((p) => p.t > now - 5 * 60_000).slice(-60);
        }
        const old = trail.current.find((p) => p.t >= now - 10_000);
        const speed = old && smoothed !== null ? Math.abs(smoothed - old.mid) * 100 : 0;
        setState({ mid: q.mid, smoothed, trail: [...trail.current], speed, at: q.at ?? now, error: null });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: (e as Error).message }));
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, windowS]);

  return state;
}
