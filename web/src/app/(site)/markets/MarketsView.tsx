"use client";

import { CatState } from "@/components/cat/CatState";
import Link from "next/link";
import { EventBlocks, GeminiCredit, groupByEvent, midYes, type CatalogResponse, type MarketItem } from "@/components/cat/Markets";
import { GeminiLink } from "@/components/cat/GeminiLink";
import { C, F } from "@/components/cat/tokens";
import { More } from "@/components/ui/More";
import { usePolling } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { fullLabel } from "@/lib/statement";

const cents = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}¢`);
const usd = (x: number | null) => (x === null ? "–" : x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x)}`);
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 600, color: C.muted, padding: "8px 10px 8px 0", borderBottom: `1.5px solid ${C.ink}` };
const td: React.CSSProperties = { fontSize: 15, padding: "9px 10px 9px 0", borderBottom: `1px solid ${C.faint}`, verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const h2: React.CSSProperties = { margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 };
const note: React.CSSProperties = { margin: 0, fontSize: 13, color: C.muted, maxWidth: 760 };

/** How many events the top list shows; every market is in the fold-out below it. */
const TOP = 8;

export function MarketsView() {
  const { data, error } = usePolling<CatalogResponse>("/api/catalog?usable=1&limit=200", 120_000);
  if (error && !data) return <CatState kind="error" text={error} />;
  if (!data) return <CatState kind="loading" text="Reading Gemini’s markets…" />;

  const groups = new Map<string, MarketItem[]>();
  for (const m of data.items) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);
  // The catalog arrives ranked best first, so the first contract of each event is its best one.
  const top = groupByEvent(data.items).slice(0, TOP);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <h2 style={h2}>By category</h2>
          <span style={{ fontSize: 14, color: C.muted }}>Checked {formatClock(data.at)}</span>
        </div>
        <div style={{ overflowX: "auto", position: "relative" }} tabIndex={0} role="region" aria-label="Markets by category (scrolls sideways)">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>Category</th>
                <th style={{ ...th, textAlign: "right" }}>Events</th>
                <th style={{ ...th, textAlign: "right" }}>Contracts</th>
                <th style={{ ...th, textAlign: "right" }}>Work now</th>
                <th style={{ ...th, textAlign: "right" }}>Median spread</th>
                <th style={{ ...th, textAlign: "right" }}>Median depth</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.map((s) => (
                <tr key={s.category}>
                  <td style={{ ...td, fontWeight: 600 }}>{s.category}</td>
                  <td style={num}>{s.events}</td>
                  <td style={num}>{s.contracts}</td>
                  <td style={{ ...num, fontWeight: 600 }}>{s.works + s.borderline}</td>
                  <td style={num}>{cents(s.medianSpread)}</td>
                  <td style={num}>{usd(s.medianDepthUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <More label="What spread and depth mean">
          <p style={note}>
            Spread: best ask minus best bid, on contracts with both sides quoted. Depth: dollars resting within 5¢ of the middle price on the thinner side,
            where measured. “Work now” includes borderline markets at the edge of the rule.
            {data.lastSweep ? ` Full list last read ${formatClock(data.lastSweep)}.` : " First full read still running."}
          </p>
        </More>
      </section>

      {groups.size === 0 ? (
        <p style={{ margin: 0, fontSize: 17 }}>No market passes right now. Check back in a few minutes.</p>
      ) : (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={h2}>Best right now</h2>
          <div style={{ overflowX: "auto", position: "relative" }} tabIndex={0} role="region" aria-label="Best markets (scrolls sideways)">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={th}>Market</th>
                  <th style={{ ...th, textAlign: "right" }}>Chance</th>
                  <th style={{ ...th, textAlign: "right" }}>Spread</th>
                  <th style={{ ...th, textAlign: "right" }}>Depth</th>
                  <th style={{ ...th, textAlign: "right" }}>Trade</th>
                </tr>
              </thead>
              <tbody>
                {top.map((g) => {
                  const m = g.items[0];
                  return (
                    <tr key={g.key}>
                      <td style={td}>
                        <span style={{ display: "block", fontWeight: 600 }}>{fullLabel(m)}</span>
                        <span style={{ display: "block", fontSize: 13, color: C.muted }}>{g.teams ?? g.title}</span>
                      </td>
                      <td style={num}>{pct(midYes(m))}</td>
                      <td style={num}>{cents(m.quality.spread)}</td>
                      <td style={num}>{usd(m.quality.minDepthUsd)}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <GeminiLink ticker={g.key} slug={g.slug} label="Gemini" size={14} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <More label={`Show all ${data.items.length} markets`}>
            {[...groups.entries()].map(([category, items]) => (
              <section key={category} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                <h3 style={{ ...h2, fontSize: 30 }}>{category}</h3>
                <EventBlocks items={items} detail />
              </section>
            ))}
          </More>
        </section>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <Link href="/pots/new" style={{ fontSize: 17, fontWeight: 600 }}>
          Start a pot on one of these
        </Link>
        <GeminiCredit />
      </div>
      <p style={note}>Prices are Gemini&apos;s quotes, not a forecast. Test version on Arc testnet.</p>
    </div>
  );
}
