"use client";

import Link from "next/link";
import { closesIn, GeminiCredit, midYes, QualityMark, type CatalogResponse, type MarketItem } from "@/components/cat/Markets";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { formatClock } from "@/lib/format";

const cents = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}¢`);
const usd = (x: number | null) => (x === null ? "–" : x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x)}`);
const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 600, color: C.muted, padding: "8px 10px 8px 0", borderBottom: `1.5px solid ${C.ink}` };
const td: React.CSSProperties = { fontSize: 15, padding: "9px 10px 9px 0", borderBottom: `1px solid ${C.faint}`, verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

export function MarketsView() {
  const { data, error } = usePolling<CatalogResponse>("/api/catalog?usable=1&limit=200", 30_000);
  if (error && !data) return <p style={{ fontSize: 17, color: C.signalInk }}>{error}</p>;
  if (!data) return <p style={{ fontSize: 17, color: C.muted }}>Reading Gemini’s markets…</p>;

  const groups = new Map<string, MarketItem[]>();
  for (const m of data.items) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>By category</h2>
          <span style={{ fontSize: 14, color: C.muted }}>
            Checked {formatClock(data.at)}
            {data.lastSweep ? `; full list last read ${formatClock(data.lastSweep)}` : "; first full read still running"}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
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
        <p style={{ margin: 0, fontSize: 13, color: C.muted, maxWidth: 760 }}>
          Spread: best ask minus best bid, on contracts with both sides quoted. Depth: dollars resting within 5¢ of the middle price on the thinner side, where
          measured. “Work now” includes borderline markets that sit at the edge of the rule.
        </p>
      </section>

      {groups.size === 0 && <p style={{ margin: 0, fontSize: 17 }}>No market passes right now. Check back in a few minutes.</p>}
      {[...groups.entries()].map(([category, items]) => (
        <section key={category} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>{category}</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>Market</th>
                  <th style={{ ...th, textAlign: "right" }}>Chance</th>
                  <th style={{ ...th, textAlign: "right" }}>Bid</th>
                  <th style={{ ...th, textAlign: "right" }}>Ask</th>
                  <th style={{ ...th, textAlign: "right" }}>Depth</th>
                  <th style={{ ...th, textAlign: "right" }}>Event 24 h volume</th>
                  <th style={{ ...th, textAlign: "right" }}>Closes in</th>
                  <th style={th}>Quality</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => {
                  const bid = m.book?.bid ?? m.bid;
                  const ask = m.book?.ask ?? m.ask;
                  const mid = midYes(m);
                  return (
                    <tr key={m.symbol}>
                      <td style={td}>
                        <span style={{ display: "block", fontSize: 13, color: C.muted }}>{m.eventTitle}</span>
                        <span style={{ fontWeight: 600 }}>{m.label}</span>
                      </td>
                      <td style={{ ...num, fontFamily: F.cond, fontSize: 20, fontWeight: 600 }}>{mid === null ? "–" : `${Math.round(mid * 100)}%`}</td>
                      <td style={num}>{cents(bid)}</td>
                      <td style={num}>{cents(ask)}</td>
                      <td style={num}>{usd(m.quality.minDepthUsd)}</td>
                      <td style={num}>{m.eventVolume24h === null ? "–" : usd(m.eventVolume24h)}</td>
                      <td style={num}>{closesIn(m.closeMs)}</td>
                      <td style={td}>
                        <QualityMark q={m.quality} small />
                        {m.quality.reasons.length > 0 && <span style={{ display: "block", fontSize: 12, color: C.muted }}>{m.quality.reasons.join("; ")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <Link href="/early/new" style={{ fontSize: 17, fontWeight: 600 }}>
          Start a pot on one of these
        </Link>
        <GeminiCredit />
      </div>
      <p style={{ margin: 0, fontSize: 13, color: C.muted, maxWidth: 760 }}>
        Gemini publishes 24-hour volume per event, not per contract. Prices are the market’s current quotes, not a forecast, and can be wrong. Test version on
        Arc testnet; not insurance.
      </p>
    </div>
  );
}
