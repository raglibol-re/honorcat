"use client";

import { useEffect, useState } from "react";
import { C } from "@/components/cat/tokens";
import { ButtonLink } from "@/components/ui/Button";

/**
 * "about 5 cats watching" (shown from three) for a pot ("123"), perp ("-4") or group ("g2"), from a heartbeat every 30 s
 * while the page is visible, with "Start your own" for spectators and a link to the big screen.
 */
export function Watching({ watchKey, startHref, tvHref, player = false, big = false }: { watchKey: string; startHref?: string; tvHref?: string; player?: boolean; big?: boolean }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let stop = false;
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch("/api/hc/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pot: watchKey }) }).catch(() => null);
      const j = r && r.ok ? ((await r.json()) as { watching: number }) : null;
      if (!stop && j) setN(j.watching);
    };
    void beat();
    const t = setInterval(beat, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [watchKey]);
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: big ? 26 : 16, color: C.body }}>
      {/* A rough count (it can be inflated), and only once a few are watching. */}
      {n !== null && n >= 3 && <span aria-live="polite">about {n} cats watching</span>}
      {!player && startHref && (
        <ButtonLink href={startHref} variant="quiet" size="sm">
          Start your own
        </ButtonLink>
      )}
      {tvHref && !big && (
        <a href={tvHref} target="_blank" rel="noreferrer">
          Big screen
        </a>
      )}
    </div>
  );
}
