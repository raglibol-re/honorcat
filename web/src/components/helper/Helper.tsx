"use client";

import { useEffect, useState } from "react";
import { Cat, type CatPose } from "@/components/cat/Cat";
import { C, F } from "@/components/cat/tokens";

/**
 * The helper cat (docs/grokcat-spec.md): a second cat beside the market cat that explains and
 * informs, never moves money and never says which side to take or whether to leave. It has a light
 * coat with an ink outline and a signal-coloured collar, so it never looks like a player's cat.
 * Until xAI credits exist its sentences come from our own templates; every number in them is put in
 * by our code from our own data.
 */
export const HELPER_FUR = { hex: "#FAF8F3", label: "Light", light: true } as const;
const MUTE_KEY = "honorcat.helper.muted";

export function HelperCat({ pose, size = 90, label }: { pose: CatPose; size?: number; label?: string }) {
  return <Cat pose={pose} size={size} fur={HELPER_FUR} collar label={label ?? `The helper cat, ${POSE_WORD[pose] ?? "here"}.`} />;
}
const POSE_WORD: Partial<Record<CatPose, string>> = {
  talk: "talking",
  think: "thinking",
  shrug: "shrugging: it does not know",
  point: "pointing at the rope",
  corner: "peeking in from the corner",
  sleep: "asleep",
  sit: "on its post",
};

/** Whether the player muted the helper cat (remembered in this browser). */
export function useHelperMuted() {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(MUTE_KEY) === "1") void Promise.resolve().then(() => setMuted(true));
    } catch {
      /* no storage: not muted */
    }
  }, []);
  const set = (m: boolean) => {
    setMuted(m);
    try {
      if (m) localStorage.setItem(MUTE_KEY, "1");
      else localStorage.removeItem(MUTE_KEY);
    } catch {
      /* this tab only */
    }
  };
  return [muted, set] as const;
}

/**
 * One speech bubble from the helper cat: a few short sentences, dismissed with one tap, a mute that
 * is remembered, and "This cat can be wrong" in small print. Screen readers hear it politely.
 * Never placed over the rope or the amounts: it sits in the flow of the page, beside its cat.
 */
export function HelperBubble({ lines, pose = "talk", onClose }: { lines: string[]; pose?: CatPose; onClose?: () => void }) {
  const [muted, setMuted] = useHelperMuted();
  const [open, setOpen] = useState(true);
  if (!lines.length) return null;
  if (muted)
    return (
      <button type="button" onClick={() => setMuted(false)} style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, minHeight: 32, color: C.muted, textDecoration: "underline", cursor: "pointer", fontSize: 14 }}>
        Unmute the helper cat
      </button>
    );
  if (!open) return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, maxWidth: 640 }}>
      <div style={{ flex: "none" }}>
        <HelperCat pose={pose} size={84} />
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-label="The helper cat says"
        style={{ position: "relative", flex: 1, border: `1.5px solid ${C.ink}`, background: "#FAF8F3", padding: "10px 12px 8px", display: "flex", flexDirection: "column", gap: 6 }}
      >
        <span aria-hidden="true" style={{ position: "absolute", left: -9, bottom: 14, width: 14, height: 14, background: "#FAF8F3", borderLeft: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, transform: "rotate(45deg)" }} />
        {lines.map((l, i) => (
          <p key={i} style={{ margin: 0, fontSize: 15.5, lineHeight: 1.45, color: C.ink }}>
            {l}
          </p>
        ))}
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.muted, fontFamily: F.sans }}>This cat can be wrong.</span>
          <button type="button" onClick={() => (setOpen(false), onClose?.())} style={{ background: "none", border: 0, padding: "4px 0", minHeight: 28, color: C.ink, textDecoration: "underline", cursor: "pointer", fontSize: 13 }}>
            Got it
          </button>
          <button type="button" onClick={() => setMuted(true)} style={{ background: "none", border: 0, padding: "4px 0", minHeight: 28, color: C.muted, textDecoration: "underline", cursor: "pointer", fontSize: 13 }}>
            Mute the helper cat
          </button>
        </div>
      </div>
    </div>
  );
}
