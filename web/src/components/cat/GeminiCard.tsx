"use client";

import { geminiEventUrl } from "@/lib/geminiLink";
import { GeminiMark } from "./Markets";
import { C, F } from "./tokens";

/**
 * A card that takes the player to the market's own page on Gemini: the Gemini mark, the question,
 * today's prices for each side and a clear "open on Gemini" call. Opens a new tab; renders nothing
 * without the event's ticker. A referral or campaign query can be added with
 * NEXT_PUBLIC_GEMINI_LINK_QUERY (for example "ref=yourcode"); none is added by default.
 */
export function GeminiCard({ ticker, slug, question, yes, no, price }: { ticker: string | null | undefined; slug?: string | null; question: string; yes?: string; no?: string; price?: number | null }) {
  const base = geminiEventUrl(ticker, slug);
  if (!base) return null;
  const extra = process.env.NEXT_PUBLIC_GEMINI_LINK_QUERY;
  const url = extra && /^[\w.~-]+=[\w.~%-]+(&[\w.~-]+=[\w.~%-]+)*$/.test(extra) ? `${base}?${extra}` : base;
  const yesC = price == null ? 0 : Math.round(price * 100); // NO is 100 minus YES, so the two always add up
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="hc-gemini-card"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
        padding: "14px 18px",
        border: `2px solid ${C.ink}`,
        background: C.page,
        color: C.ink,
        textDecoration: "none",
        maxWidth: 680,
        boxShadow: `4px 4px 0 ${C.ink}`,
      }}
    >
      <GeminiMark size={44} />
      <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>The market on Gemini</span>
        <span style={{ fontFamily: F.cond, fontSize: 24, fontWeight: 600, lineHeight: 1.1, overflowWrap: "anywhere" }}>{question}</span>
        {price != null && (
          <span style={{ fontSize: 15, color: C.body }}>
            {yes ?? "YES"} {yesC}¢ · {no ?? "NO"} {100 - yesC}¢ right now
          </span>
        )}
      </span>
      <span aria-hidden="true" style={{ fontFamily: F.cond, fontSize: 18, fontWeight: 600, whiteSpace: "nowrap", borderBottom: `2px solid ${C.ink}` }}>
        Open on Gemini →
      </span>
      <span className="hc-sr"> (opens Gemini in a new tab)</span>
    </a>
  );
}
