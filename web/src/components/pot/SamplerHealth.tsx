"use client";

import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { short } from "@/lib/format";
import { useNow } from "@/lib/useNow";

type Health = { ok: boolean; alive: number; threshold: number; samplers: { address: string; lastSeen: number | null; alive: boolean }[] };

export function useSamplerHealth() {
  return usePolling<Health>("/api/health/samplers", 15_000).data;
}

/** A plain notice on pot pages when fewer than two samplers are running: nothing can be priced. */
export function SamplerNotice() {
  const h = useSamplerHealth();
  if (!h || h.ok) return null;
  return (
    <p role="status" style={{ margin: 0, padding: "12px 14px", border: `1.5px solid ${C.signal}`, color: C.ink, fontSize: 16, lineHeight: 1.45 }}>
      Only {h.alive} of the {h.samplers.length} price samplers are running right now, and {h.threshold} must agree. Until another one is back, joins and exits
      cannot be priced (a join is refunded, an exit fails and the pot continues) and the result waits to be settled. Nothing is lost.
    </p>
  );
}

/** The list for /status: each sampler and when it last asked for work. */
export function SamplerList() {
  const h = useSamplerHealth();
  const now = Math.floor(useNow() / 1000);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Price samplers</h2>
      <p style={{ margin: 0, fontSize: 16, color: C.body, maxWidth: 680 }}>
        {h ? `${h.alive} of ${h.samplers.length} running; ${h.threshold} must agree for any price. ` : ""}A sampler counts as running if it asked for work in the last two minutes.
        Uptime monitors can watch <span style={{ fontFamily: F.mono, fontSize: 14 }}>/api/health/samplers</span> (503 below the threshold).
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
        {(h?.samplers ?? []).map((s) => (
          <li key={s.address} style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "10px 0", borderBottom: `1px solid ${C.faint}`, fontSize: 16 }}>
            <span style={{ fontFamily: F.mono, fontSize: 14 }}>{short(s.address, 6)}</span>
            <strong style={{ color: s.alive ? C.ink : C.signalInk }}>{s.alive ? "running" : "not seen"}</strong>
            <span style={{ color: C.muted }}>{s.lastSeen ? `last seen ${Math.max(0, now - s.lastSeen)} s ago` : "never seen"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Delayed = { ok: boolean; ropes: { potId: string; expiry: number; lateS: number }[]; waitingForResult?: { potId: string }[] };

/** The list for /status: short ropes running well past their end (no agreed end price yet). */
export function DelayedRopes() {
  const h = usePolling<Delayed>("/api/health/ropes", 15_000).data;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Ropes past their end</h2>
      <p style={{ margin: 0, fontSize: 16, color: C.body, maxWidth: 680 }}>
        {!h ? "Checking…" : h.ok ? "None: every short rope ended on time." : `${h.ropes.length} running more than 150 s past their end, waiting for a price the samplers agree on. The money stays in the contract.`}{" "}
        {h?.waitingForResult?.length ? `${h.waitingForResult.length} more ${h.waitingForResult.length === 1 ? "waits" : "wait"} for the market's result (no end price after four tries, as the contract says). ` : ""}
        Uptime monitors can watch <span style={{ fontFamily: F.mono, fontSize: 14 }}>/api/health/ropes</span> (503 while any is late).
      </p>
      {h && !h.ok && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
          {h.ropes.map((r) => (
            <li key={r.potId} style={{ display: "flex", gap: 16, padding: "10px 0", borderBottom: `1px solid ${C.faint}`, fontSize: 16 }}>
              <a href={`/pots/${r.potId}`}>pot {r.potId}</a>
              <span style={{ color: C.muted }}>{Math.round(r.lateS / 60)} min late</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
