"use client";

import Link from "next/link";
import { Cat } from "@/components/cat/Cat";
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
  timeline: { potId: string; at: number | null; what: string; tx: string }[];
};

/** An honor record: what an account did in its pots, from the contract's events. Facts only, no score. */
export function Record({ account }: { account: string }) {
  const { data: r, error } = usePolling<HonorRecord>(`/api/hc/record/${account}`, 15_000);
  if (!r) return error ? <p>{error}</p> : <Cat pose="peek" size={140} />;
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 56, fontWeight: 600, lineHeight: 0.95 }}>Honor record</h1>
        <p style={{ margin: 0, fontSize: 17, color: C.body }}>
          <a href={addressUrl(r.account)} target="_blank" rel="noreferrer" style={{ fontFamily: F.mono, fontSize: 15 }}>
            {short(r.account, 6)}
          </a>
          . Facts from the pot contract&apos;s events on Arc testnet, nothing else.
        </p>
      </header>
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
          <p style={{ margin: 0, color: C.muted }}>Nothing yet.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
            {r.timeline.map((t, i) => (
              <li key={i} style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", padding: "10px 0", borderBottom: `1px solid ${C.faint}`, fontSize: 16 }}>
                <span style={{ color: C.muted, minWidth: 150 }}>{t.at ? formatDate(t.at * 1000) : ""}</span>
                <Link href={`/pots/${t.potId}`}>Pot {t.potId}</Link>
                <span>{t.what}</span>
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
