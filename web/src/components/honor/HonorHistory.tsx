"use client";

import Link from "next/link";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Bell, fmtHonor } from "./Honor";

type Entry = { seq: number; at: number; action: string; pot_id: string | null; counterparty: string | null; base: number; points: number; notes: string[]; removed: string | null };
type Honor = {
  points: number;
  title: string;
  cosmetics: { next: { label: string; need: string; left: string } | null };
  history?: Entry[];
  state: { computedAt: number; lastBlock: number; version: number } | null;
};

const ACTION: Record<string, string> = {
  held: "Held to the end",
  handshake: "Handshake",
  joined: "Their open side was joined",
  takeover: "Took over a side",
  goodGame: "Said “Well played”",
  referral: "A friend they invited finished a pot",
  streak: "Played on consecutive days",
  smallerTeam: "Joined the smaller team",
};

/** A player's honor: points, title, the next cosmetic, and every honor event with its reductions. */
export function HonorHistory({ account }: { account: string }) {
  const { data, error } = usePolling<Honor>(`/api/hc/honor?account=${account}&history=1`, 120_000);
  if (error && /404|off/.test(error)) return null;
  if (!data) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600, display: "flex", gap: 10, alignItems: "center" }}>
        <Bell size={28} /> Honor: {fmtHonor(data.points)} · {data.title}
      </h2>
      <p style={{ margin: 0, fontSize: 16, color: C.body, maxWidth: 720 }}>
        Earned by how they play, never by what they win; no cash value. {data.cosmetics.next ? `Next: ${data.cosmetics.next.label} (${data.cosmetics.next.left} to go).` : ""}{" "}
        <Link href="/honor">How honor works</Link>
      </p>
      {data.history && data.history.length > 0 ? (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}`, maxWidth: 820 }}>
          {data.history.map((e) => (
            <li key={e.seq} style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", padding: "9px 2px", borderBottom: `1px solid ${C.faint}`, fontSize: 15 }}>
              <span style={{ minWidth: 92, color: C.muted }}>{formatDate(e.at * 1000)}</span>
              <span style={{ flex: "1 1 260px" }}>
                {ACTION[e.action] ?? e.action}
                {e.pot_id && (
                  <>
                    {" · "}
                    <Link href={e.pot_id.startsWith("-") ? `/perps/${e.pot_id.slice(1)}` : `/pots/${e.pot_id}`}>
                      {e.pot_id.startsWith("-") ? `perp ${e.pot_id.slice(1)}` : `pot ${e.pot_id}`}
                    </Link>
                  </>
                )}
                {(e.notes.length > 0 || e.removed) && (
                  <span style={{ display: "block", fontSize: 14, color: e.removed ? C.signalInk : C.muted }}>{[e.removed ? `removed: ${e.removed}` : null, ...e.notes].filter(Boolean).join(" · ")}</span>
                )}
              </span>
              <strong style={{ fontVariantNumeric: "tabular-nums", color: e.removed ? C.muted : C.ink, textDecoration: e.removed ? "line-through" : "none" }}>
                +{fmtHonor(e.removed ? e.base : e.points)}
              </strong>
            </li>
          ))}
        </ol>
      ) : (
        <p style={{ margin: 0, fontSize: 16, color: C.muted }}>No honor yet.</p>
      )}
      {data.state && (
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
          Counted from Arc events up to block {data.state.lastBlock} (rules version {data.state.version}), {formatDate(data.state.computedAt * 1000)}.
        </p>
      )}
    </section>
  );
}
