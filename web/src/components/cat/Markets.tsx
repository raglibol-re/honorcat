"use client";

import { useState } from "react";
import { usePolling } from "@/lib/api";
import { CatHead } from "./shapes";
import { C, F } from "./tokens";

/* ------------------------------------------------------------------ shared types (mirror server/catalog.ts) */

export type QualityStatus = "works" | "borderline" | "unmeasured" | "unavailable";
export type MarketQuality = { status: QualityStatus; profile: "demo" | "standard"; reasons: string[]; spread: number | null; minSize: number | null; minDepthUsd: number | null };
export type MarketBook = { at: number; bid: number | null; ask: number | null; bidSize: number | null; askSize: number | null; bidDepth: number; askDepth: number; bidDepthUsd: number; askDepthUsd: number };
export type MarketItem = {
  symbol: string;
  eventTicker: string;
  contractTicker: string;
  category: string;
  subcategory: string | null;
  eventTitle: string;
  label: string;
  closeMs: number;
  bid: number | null;
  ask: number | null;
  eventVolume24h: number | null;
  image: string | null;
  book: MarketBook | null;
  quality: MarketQuality;
};
export type CategorySummary = { category: string; events: number; contracts: number; works: number; borderline: number; medianSpread: number | null; medianDepthUsd: number | null };
export type CatalogResponse = { total: number; items: MarketItem[]; summary: CategorySummary[]; categories: string[]; lastSweep: number | null; at: number };

/* ------------------------------------------------------------------ small pieces */

export const usable = (q: MarketQuality | null | undefined) => q?.status === "works" || q?.status === "borderline";

/** YES midpoint from the freshest prices we have (book, else listing). */
export function midYes(m: Pick<MarketItem, "bid" | "ask" | "book">): number | null {
  const bid = m.book?.bid ?? m.bid;
  const ask = m.book?.ask ?? m.ask;
  return bid !== null && ask !== null ? (bid + ask) / 2 : null;
}

export function closesIn(ms: number, now = Date.now()) {
  const d = ms - now;
  if (d <= 0) return "closed";
  if (d < 3600_000) return `${Math.max(1, Math.round(d / 60_000))} min`;
  if (d < 48 * 3600_000) return `${Math.round(d / 3600_000)} h`;
  return `${Math.round(d / 86_400_000)} days`;
}

const STATUS_TEXT: Record<QualityStatus, string> = { works: "Works", borderline: "Borderline", unmeasured: "Checking", unavailable: "Unavailable" };

/** Works: ink cat head. Borderline: outlined head. Checking: faint outline. Unavailable: none, muted. */
export function QualityMark({ q, small }: { q: MarketQuality | null; small?: boolean }) {
  const s = q?.status ?? "unmeasured";
  const w = small ? 14 : 18;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: small ? 13 : 14, fontWeight: 600, color: s === "unavailable" ? C.signalInk : s === "unmeasured" ? C.muted : C.ink }}>
      {s === "works" ? (
        <CatHead width={w} height={w - 1} />
      ) : s === "borderline" ? (
        <CatHead width={w} height={w - 1} outline />
      ) : s === "unmeasured" ? (
        <CatHead width={w} height={w - 1} outline fill={C.faint} />
      ) : (
        <span aria-hidden style={{ width: w, height: 2, background: C.signalInk, display: "inline-block" }} />
      )}
      {STATUS_TEXT[s]}
    </span>
  );
}

/** "Data provided by Gemini", required wherever a Gemini price appears (Market Data Agreement). */
export function GeminiCredit({ style }: { style?: React.CSSProperties }) {
  return (
    <span style={{ fontSize: 13, color: C.muted, ...style }}>
      Data provided by{" "}
      <a href="https://www.gemini.com/predictions" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
        Gemini
      </a>
    </span>
  );
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const usd = (x: number | null) => (x === null ? "–" : x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x)}`);

/* ------------------------------------------------------------------ the picker */

const WITHIN: [string, number | null][] = [
  ["Any time", null],
  ["Closes within 2 h", 2],
  ["Within a day", 24],
  ["Within a week", 168],
];

/**
 * Every active Gemini contract in one list, sorted by measured quality under the rule its pot would
 * get. Contracts that would not work stay visible, muted, with the reason, and cannot be picked.
 */
export function MarketList({ picked, onPick }: { picked: string | null; onPick: (m: MarketItem) => void }) {
  const [category, setCategory] = useState("");
  const [within, setWithin] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(25);
  const qs = new URLSearchParams({ limit: String(limit) });
  if (category) qs.set("category", category);
  if (within) qs.set("within", String(within));
  if (q.trim()) qs.set("q", q.trim());
  const { data, error } = usePolling<CatalogResponse>(`/api/catalog?${qs}`, 15_000);
  const sel: React.CSSProperties = { minHeight: 44, border: `1.5px solid ${C.ink}`, background: C.panel, color: C.ink, fontFamily: F.sans, fontSize: 16, padding: "0 10px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search: Fed, Chicago, Bitcoin…"
          aria-label="Search markets"
          style={{ ...sel, flex: "1 1 220px", padding: "0 12px" }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" style={sel}>
          <option value="">All categories</option>
          {(data?.categories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={within ?? ""} onChange={(e) => setWithin(e.target.value ? Number(e.target.value) : null)} aria-label="Time to close" style={sel}>
          {WITHIN.map(([t, v]) => (
            <option key={t} value={v ?? ""}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {error && !data && <p style={{ margin: 0, fontSize: 16, color: C.signalInk }}>{error}</p>}
      {!data && !error && <p style={{ margin: 0, fontSize: 16, color: C.muted }}>Reading Gemini’s markets…</p>}
      {data && data.total === 0 && (
        <p style={{ margin: 0, fontSize: 16 }}>{data.summary.length ? "Nothing matches. Clear the search or pick another category." : "The market list is still loading. Give it a minute."}</p>
      )}

      {data && data.items.length > 0 && (
        <ul role="radiogroup" aria-label="Markets" style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}` }}>
          {data.items.map((m, i) => {
            const ok = usable(m.quality);
            const on = picked === m.symbol;
            const chance = midYes(m);
            return (
              <li key={m.symbol} style={{ borderTop: i ? `1px solid ${C.faint}` : "none" }}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={!ok}
                  onClick={() => ok && onPick(m)}
                  className={ok ? "hc-row" : undefined}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "11px 10px",
                    border: 0,
                    textAlign: "left",
                    fontFamily: F.sans,
                    background: on ? C.ink : "transparent",
                    color: on ? C.page : ok ? C.ink : C.muted,
                    cursor: ok ? "pointer" : "not-allowed",
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, color: on ? C.faint : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.category} · {m.eventTitle}
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.25 }}>{m.label}</span>
                    <span style={{ fontSize: 13, color: on ? C.faint : m.quality.status === "unavailable" ? C.signalInk : C.muted }}>
                      {m.quality.status === "unavailable" || m.quality.status === "unmeasured"
                        ? m.quality.reasons.join("; ")
                        : `spread ${Math.round((m.quality.spread ?? 0) * 100)}¢ · ${usd(m.quality.minDepthUsd)} near the price · ${m.quality.profile} rule`}
                      {` · closes in ${closesIn(m.closeMs)}`}
                    </span>
                  </span>
                  <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span style={{ fontFamily: F.cond, fontSize: 26, fontWeight: 600, lineHeight: 1 }}>{pct(chance)}</span>
                    {on ? <span style={{ fontSize: 13, fontWeight: 600 }}>Picked</span> : <QualityMark q={m.quality} small />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: C.muted }}>
            {data.total} contracts, usable first. Chance = middle of the best buy and sell price.{" "}
            <a href="/markets" style={{ color: "inherit" }}>
              Markets that work today
            </a>
          </span>
          <GeminiCredit />
        </div>
      )}
      {data && data.items.length < data.total && (
        <button
          type="button"
          onClick={() => setLimit(limit + 25)}
          style={{ alignSelf: "flex-start", minHeight: 44, padding: "0 16px", background: "transparent", border: `1.5px solid ${C.ink}`, fontFamily: F.sans, fontSize: 16, fontWeight: 600, cursor: "pointer" }}
        >
          Show 25 more
        </button>
      )}
    </div>
  );
}
