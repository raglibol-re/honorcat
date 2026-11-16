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

/** Gemini's own app mark (unmodified, from gemini.com), used only to credit Gemini as the source. */
export function GeminiMark({ size = 16 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small static brand mark
    <img src="/gemini-mark.png" alt="Gemini" width={size} height={size} style={{ display: "inline-block", width: size, height: size, borderRadius: size * 0.22, verticalAlign: "middle", flex: "none" }} />
  );
}

/** "Data provided by Gemini", required wherever a Gemini price appears (Market Data Agreement). */
export function GeminiCredit({ style }: { style?: React.CSSProperties }) {
  return (
    <span style={{ fontSize: 13, color: C.muted, display: "inline-flex", alignItems: "center", gap: 6, ...style }}>
      <GeminiMark size={14} />
      <span>
        Data provided by{" "}
        <a href="https://www.gemini.com/predictions" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
          Gemini
        </a>
      </span>
    </span>
  );
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const usd = (x: number | null) => (x === null ? "–" : x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x)}`);

/* ------------------------------------------------------------------ events, grouped */

type EventGroup = { key: string; title: string; category: string; subcategory: string | null; image: string | null; closeMs: number; volume: number | null; items: MarketItem[] };

/** Contracts grouped by their Gemini event, in the order the list ranks them. */
export function groupByEvent(items: MarketItem[]): EventGroup[] {
  const map = new Map<string, EventGroup>();
  for (const m of items) {
    const g = map.get(m.eventTicker);
    if (g) g.items.push(m);
    else map.set(m.eventTicker, { key: m.eventTicker, title: m.eventTitle, category: m.category, subcategory: m.subcategory, image: m.image, closeMs: m.closeMs, volume: m.eventVolume24h, items: [m] });
  }
  return [...map.values()];
}

function Thumb({ src, size }: { src: string | null; size: number }) {
  if (!src || !/^https:\/\/assets\.gemini\.com\//.test(src))
    return (
      <span aria-hidden="true" style={{ flex: "none", width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.panel, border: `1px solid ${C.faint}` }}>
        <GeminiMark size={size * 0.45} />
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element -- Gemini's own event artwork, served by Gemini
  return <img src={src} alt="" width={size} height={size} loading="lazy" style={{ flex: "none", width: size, height: size, objectFit: "cover", background: C.panel }} />;
}

/** One possible result of an event: its chance as a bar, pickable when the market works. */
function Outcome({ m, picked, onPick, detail }: { m: MarketItem; picked: boolean; onPick?: (m: MarketItem) => void; detail?: boolean }) {
  const ok = usable(m.quality);
  const chance = midYes(m);
  const w = chance === null ? 0 : Math.max(2, Math.round(chance * 100));
  const bid = m.book?.bid ?? m.bid;
  const ask = m.book?.ask ?? m.ask;
  const canPick = ok && !!onPick;
  const reason = m.quality.reasons.join("; ");
  const Tag = onPick ? "button" : "div";
  return (
    <Tag
      {...(onPick ? { type: "button" as const, role: "radio", "aria-checked": picked, "aria-disabled": !ok, onClick: () => canPick && onPick(m) } : {})}
      className={canPick ? "hc-row" : undefined}
      title={ok ? undefined : reason}
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.4fr) minmax(80px, 2fr) 56px",
        alignItems: "center",
        gap: 14,
        padding: "9px 10px",
        border: 0,
        textAlign: "left",
        fontFamily: F.sans,
        background: picked ? C.ink : "transparent",
        color: picked ? C.page : ok ? C.ink : C.muted,
        cursor: canPick ? "pointer" : onPick ? "not-allowed" : "default",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: picked ? C.faint : m.quality.status === "unavailable" ? C.signalInk : C.muted }}>
          {picked ? <span style={{ fontWeight: 600 }}>Picked</span> : <QualityMark q={m.quality} small />}
          {detail && ok && <span>{`${bid === null ? "–" : Math.round(bid * 100)}¢ / ${ask === null ? "–" : Math.round(ask * 100)}¢ · ${usd(m.quality.minDepthUsd)} near the price`}</span>}
          {!ok && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reason}</span>}
        </span>
      </span>
      <span aria-hidden="true" style={{ height: 8, background: picked ? C.muted : C.grid, position: "relative" }}>
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${w}%`, background: picked ? C.signal : ok ? C.ink : C.faint, transition: "width 600ms ease" }} />
      </span>
      <span style={{ fontFamily: F.cond, fontSize: 24, fontWeight: 600, lineHeight: 1, textAlign: "right" }}>{pct(chance)}</span>
    </Tag>
  );
}

/**
 * Gemini's markets as events: the event's own artwork, title, category, close and volume, and each
 * possible result as a chance bar. With `onPick` the results are a radio group for choosing one.
 */
export function EventBlocks({ items, picked, onPick, detail }: { items: MarketItem[]; picked?: string | null; onPick?: (m: MarketItem) => void; detail?: boolean }) {
  const groups = groupByEvent(items);
  return (
    <div role={onPick ? "radiogroup" : undefined} aria-label={onPick ? "Markets" : undefined} style={{ display: "flex", flexDirection: "column", borderTop: `1.5px solid ${C.ink}` }}>
      {groups.map((g) => (
        <section key={g.key} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 0 10px", borderBottom: `1px solid ${C.faint}` }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "0 10px" }}>
            <Thumb src={g.image} size={52} />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13, color: C.muted }}>
                {[g.category, g.subcategory, `closes in ${closesIn(g.closeMs)}`, g.volume ? `${usd(g.volume)} traded today` : null].filter(Boolean).join(" · ")}
              </span>
              <h3 style={{ margin: 0, fontFamily: F.cond, fontSize: 24, fontWeight: 600, lineHeight: 1.05 }}>{g.title}</h3>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", paddingLeft: "min(66px, 10vw)" }}>
            {g.items.map((m) => (
              <Outcome key={m.symbol} m={m} picked={picked === m.symbol} onPick={onPick} detail={detail} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

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
  const tab = (on: boolean): React.CSSProperties => ({
    flex: "none",
    minHeight: 38,
    padding: "0 14px",
    border: `1.5px solid ${C.ink}`,
    background: on ? C.ink : "transparent",
    color: on ? C.page : C.ink,
    fontFamily: F.sans,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: C.muted }}>
        <GeminiMark size={20} />
        <span>
          Live prediction markets from <strong style={{ color: C.ink }}>Gemini</strong>, read from its order books every few seconds.
        </span>
      </div>
      <div role="tablist" aria-label="Category" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {["", ...(data?.categories ?? [])].map((c) => (
          <button key={c || "all"} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)} style={tab(category === c)}>
            {c || "All"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search: Fed, Chicago, Bitcoin…"
          aria-label="Search markets"
          style={{ ...sel, flex: "1 1 220px", padding: "0 12px" }}
        />
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

      {data && data.items.length > 0 && <EventBlocks items={data.items} picked={picked} onPick={onPick} />}
      {data && (
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: C.muted }}>
            {data.total} results, usable first. Chance = the middle of Gemini’s best buy and sell price.{" "}
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
