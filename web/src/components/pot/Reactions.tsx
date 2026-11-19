"use client";

import { useRef, useState } from "react";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";

const KINDS = ["Paw up", "Purr", "Hiss"] as const;
/** How long a gesture stays at the rope (ms). */
const SHOW_MS = 8000;

type R = { id: string; kind: number; ageMs: number };

/**
 * Cat gestures at the rope for players and spectators: paw up, purr, hiss. No free text and no
 * account needed; each gesture shows for a few seconds, then fades. `potId` is a pot id, or -perpId.
 */
export function Reactions({ potId }: { potId: string }) {
  const { data } = usePolling<{ reactions: R[] }>(`/api/hc/reactions?pot=${encodeURIComponent(potId)}`, 3000);
  const [mine, setMine] = useState<{ id: string; kind: number }[]>([]);
  const [wait, setWait] = useState(false);
  const seq = useRef(0);
  const shown = [...mine.map((m) => ({ ...m, ageMs: 0 })), ...(data?.reactions ?? []).filter((r) => r.ageMs < SHOW_MS)].slice(0, 12);

  const send = async (kind: number) => {
    if (wait) return;
    setWait(true);
    const id = `me-${++seq.current}`;
    setMine((m) => [{ id, kind }, ...m]);
    // until the server lists it (polled every 3 s), so it is not shown twice
    setTimeout(() => setMine((m) => m.filter((x) => x.id !== id)), 3500);
    setTimeout(() => setWait(false), 3000);
    await fetch("/api/hc/reactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pot: potId, kind }),
    }).catch(() => {});
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <style>{`@keyframes hcReact { 0% { transform: translateY(8px); opacity: 0 } 12% { transform: none; opacity: 1 } 80% { opacity: 1 } 100% { transform: translateY(-10px); opacity: 0 } }`}</style>
      <div aria-live="polite" style={{ minHeight: 30, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {shown.map((r) => (
          <span
            key={r.id}
            style={{
              animation: `hcReact ${SHOW_MS}ms ease-out forwards`,
              animationDelay: `-${Math.min(r.ageMs, SHOW_MS)}ms`,
              border: `1.5px solid ${r.kind === 2 ? C.signal : C.ink}`,
              color: r.kind === 2 ? C.signalInk : C.ink,
              background: C.panel,
              padding: "2px 10px",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            {KINDS[r.kind]}
          </span>
        ))}
      </div>
      <div role="group" aria-label="React at the rope" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted }}>React</span>
        {KINDS.map((k, i) => (
          <button key={k} type="button" className="hc-btn hc-btn--quiet hc-btn--sm" disabled={wait} onClick={() => void send(i)}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
