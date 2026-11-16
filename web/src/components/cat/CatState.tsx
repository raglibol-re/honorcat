"use client";

import { plainMessage } from "@/lib/messages";
import { Cat, type CatPose } from "./Cat";
import { C } from "./tokens";

/**
 * A cat in every state: loading (it peeks in), empty (it sleeps), error (it looks into an empty
 * box), success (it lands), waiting for someone (it sits at its post). One component, the one Cat;
 * the text says what is happening and what comes next, so the pose is never the only signal.
 */
export type CatStateKind = "loading" | "empty" | "error" | "success" | "waiting";
const POSE: Record<CatStateKind, CatPose> = { loading: "peek", empty: "sleep", error: "box", success: "land", waiting: "sit" };
const DEFAULT: Record<CatStateKind, string> = {
  loading: "Loading…",
  empty: "Nothing here yet.",
  error: "This could not be loaded just now. HonorCat tries again by itself.",
  success: "Done.",
  waiting: "Waiting for someone to take the other side.",
};

export function CatState({ kind, text, size = 120, children }: { kind: CatStateKind; text?: string | null; size?: number; children?: React.ReactNode }) {
  // Raw errors ("HTTP 500") become plain sentences with what happens next.
  const shown = kind === "error" && text ? (/^HTTP \d+/.test(text) ? DEFAULT.error : plainMessage(text)) : (text ?? DEFAULT[kind]);
  return (
    <div role={kind === "error" ? "alert" : "status"} aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "8px 0" }}>
      <Cat pose={POSE[kind]} size={size} label={kind === "loading" ? "A cat peeking in: loading." : undefined} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: "1 1 240px" }}>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: kind === "error" ? C.signalInk : C.body }}>{shown}</p>
        {children}
      </div>
    </div>
  );
}
