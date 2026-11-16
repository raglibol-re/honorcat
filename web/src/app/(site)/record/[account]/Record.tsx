"use client";

import { CatState } from "@/components/cat/CatState";
import Link from "next/link";
import { PlayerCat } from "@/components/cat/PlayerCat";
import { useTechMode } from "@/components/TechMode";
import { nickname, useNames } from "@/lib/names";
import { honorLabels } from "@/lib/honor";
import { sidesOf } from "@/lib/statement";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { formatDate, short } from "@/lib/format";

type HonorRecord = {
  account: string;
  pots: number;
  heldToEnd: number;
  exits: number;
  exitsByNet: number;
  exitsByBowl: number;
  handshakes: number;
  tookOver: number;
  takenOver: number;
  settledFor: number;
  settledAgainst: number;
  voided: number;
  paid: string;
  timeline: { potId: string; at: number | null; what: string; tx: string; act?: string; side?: number | null; price?: number | null; outcome?: number; how?: string }[];
  markets?: Record<string, { eventTitle: string; label: string; teams?: string | null; yesMeans?: string | null } | null>;
};

/** One line of the record in plain words: the statement the side stood for, never YES or NO. */
function lineOf(t: HonorRecord["timeline"][number], m: Parameters<typeof sidesOf>[0] | null | undefined): string {
  if (!t.act || !m) return t.what;
  const st = sidesOf(m);
  const said = (s: number | null | undefined) => `“${s === 0 ? st.yes : st.no}”`;
  const p = t.price ? `${(t.price / 10_000).toFixed(1)}%` : "";
  switch (t.act) {
    case "left":
      return `left ${said(t.side)} at ${p}${t.how && t.how !== "own" ? ` (by a ${t.how})` : ""}`;
    case "handshake":
      return `shook hands at ${p}`;
    case "tookOver":
      return `took over ${said(t.side)} at ${p}`;
    case "takenOver":
      return `was taken over on ${said(t.side)} at ${p}`;
    case "held":
      return t.outcome === 2 ? `held ${said(t.side)} to the end: Gemini voided the market` : `held ${said(t.side)} to the end: ${t.outcome === 1 ? st.yes : st.no}`;
    default:
      return t.what;
  }
}

/** An honor record: what an account did in its pots, from the contract's events. Facts only, no score. */
export function Record({ account }: { account: string }) {
  const { data: r, error } = usePolling<HonorRecord>(`/api/hc/record/${account}`, 15_000);
  const names = useNames([account]);
  const { tech } = useTechMode();
  const name = names[account.toLowerCase()] ?? nickname(account.toLowerCase());
  if (!r) return error ? <CatState kind="error" text={error} /> : <CatState kind="loading" />;
  const facts: [string, number | string][] = [
    ["Pots played", r.pots],
    ["Held to the end", r.heldToEnd],
    ["Left early", r.exits],
    ["of which by a net", r.exitsByNet],
    ["of which by a bowl", r.exitsByBowl],
    ["Handshakes", r.handshakes],
    ["Sides taken over", r.tookOver],
    ["Own side taken over", r.takenOver],
    ["Settled in their favour", r.settledFor],
    ["Settled against them", r.settledAgainst],
    ["Voided", r.voided],
    ["Paid out to them", `$${(Number(r.paid) / 1e6).toFixed(2)}`],
  ];
  const labels = honorLabels(r);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          <PlayerCat account={account} pose="sit" size={110} label={`${name}'s cat`} />
          <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 56, fontWeight: 600, lineHeight: 0.95 }}>{name}&apos;s honor record</h1>
        </div>
        <p style={{ margin: 0, fontSize: 17, color: C.body }}>
          Facts from the pot contract&apos;s events on Arc testnet, nothing else. Practice pots do not count.
          {tech && (
            <>
              {" "}
              <a href={addressUrl(r.account)} target="_blank" rel="noreferrer" style={{ fontFamily: F.mono, fontSize: 15 }}>
                {short(r.account, 6)}
              </a>
            </>
          )}
        </p>
      </header>
      <section aria-label="In short" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 10 }}>
          {labels.map((l) => (
            <li key={l.label} style={{ border: `1.5px solid ${C.ink}`, padding: "6px 12px", display: "flex", flexDirection: "column" }}>
              <strong style={{ fontFamily: F.cond, fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>{l.label}</strong>
              <span style={{ fontSize: 14, color: C.muted }}>{l.because}</span>
            </li>
          ))}
        </ul>
        <span style={{ fontSize: 14, color: C.muted }}>Read from the facts below. No score: HonorCat does not rate players.</span>
      </section>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 0, borderTop: `1.5px solid ${C.ink}` }}>
        {facts.map(([k, v]) => (
          <div key={k} style={{ padding: "14px 0", borderBottom: `1px solid ${C.faint}`, display: "flex", flexDirection: "column", gap: 2 }}>
            <dt style={{ fontSize: 15, color: C.muted, paddingLeft: k.startsWith("of which") ? 14 : 0 }}>{k}</dt>
            <dd style={{ margin: 0, fontFamily: F.cond, fontSize: 40, fontWeight: 600, lineHeight: 1, paddingLeft: k.startsWith("of which") ? 14 : 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>What happened</h2>
        {r.timeline.length === 0 ? (
          <CatState kind="empty" text="Nothing yet: no pots played (practice pots do not count)." size={110} />
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
            {r.timeline.map((t, i) => (
              <li key={i} style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", padding: "10px 0", borderBottom: `1px solid ${C.faint}`, fontSize: 16 }}>
                <span style={{ color: C.muted, minWidth: 150 }}>{t.at ? formatDate(t.at * 1000) : ""}</span>
                <Link href={`/pots/${t.potId}`}>Pot {t.potId}</Link>
                <span>{lineOf(t, r.markets?.[t.potId])}</span>
                <a href={txUrl(t.tx)} target="_blank" rel="noreferrer" style={{ color: C.muted }}>
                  transaction
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
