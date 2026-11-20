"use client";

import { useEffect, useRef, useState } from "react";
import { C, F } from "@/components/cat/tokens";
import { useActor } from "@/components/pot/Who";
import { usePolling } from "@/lib/api";
import { Bell, fmtHonor } from "./Honor";

type Latest = { points: number; history?: { seq: number; action: string; points: number; removed: string | null }[] };

const REASON: Record<string, string> = {
  held: "for holding a pot to its end",
  handshake: "for a handshake",
  joined: "because your open side was joined",
  takeover: "for taking over a side",
  goodGame: "for saying “Well played”",
  referral: "because a friend you invited finished a pot",
  streak: "for playing again today",
  smallerTeam: "for joining the smaller team",
};

/**
 * When the signed-in player earns honor: a short bell with the amount and the reason (once per new
 * entry; the last seen is kept in this browser). Still, without the swing, for reduced motion.
 */
export function HonorBell() {
  const who = useActor();
  const me = who.actor?.account ?? null;
  const { data } = usePolling<Latest>(me ? `/api/hc/honor?account=${me}&latest=1` : null, 120_000);
  const [show, setShow] = useState<{ amount: number; reason: string; key: number } | null>(null);
  const seenFor = useRef<string | null>(null);
  useEffect(() => {
    const e = data?.history?.[0];
    if (!me || !e || e.removed || e.points <= 0) return;
    const key = `honorcat.honorSeen.${me.toLowerCase()}`;
    let last = 0;
    try {
      last = Number(localStorage.getItem(key) ?? 0);
      localStorage.setItem(key, String(e.seq));
    } catch {
      /* private mode: show nothing rather than repeat */
      return;
    }
    if (seenFor.current === me && e.seq <= last) return;
    seenFor.current = me;
    if (last === 0 || e.seq <= last) return; // first visit: remember, do not ring for old honor
    void Promise.resolve().then(() => setShow({ amount: e.points, reason: REASON[e.action] ?? "", key: e.seq }));
  }, [data, me]);
  if (!show) return null;
  return (
    <div
      key={show.key}
      role="status"
      onAnimationEnd={() => setShow(null)}
      className="hc-honor-bell hc-float"
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 50, display: "flex", gap: 10, alignItems: "center", background: C.ink, color: C.page, padding: "12px 16px", fontFamily: F.sans, fontSize: 16, maxWidth: 360 }}
    >
      <style>{`
        .hc-honor-bell { animation: hcHonorFade 5s ease-out forwards; }
        .hc-honor-bell svg { animation: hcHonorSwing 0.9s ease-in-out 2; transform-origin: 50% 10%; }
        @keyframes hcHonorFade { 0% { opacity: 0; transform: translateY(8px) } 8% { opacity: 1; transform: none } 85% { opacity: 1 } 100% { opacity: 0 } }
        @keyframes hcHonorSwing { 0%,100% { transform: rotate(0) } 25% { transform: rotate(14deg) } 75% { transform: rotate(-14deg) } }
        @media (prefers-reduced-motion: reduce) {
          .hc-honor-bell { animation: hcHonorStill 5s linear forwards; }
          .hc-honor-bell svg { animation: none; }
          @keyframes hcHonorStill { 0%, 90% { opacity: 1 } 100% { opacity: 0 } }
        }
      `}</style>
      <Bell size={22} color={C.page} />
      <span>
        <strong>+{fmtHonor(show.amount)} honor</strong> {show.reason}
      </span>
    </div>
  );
}
