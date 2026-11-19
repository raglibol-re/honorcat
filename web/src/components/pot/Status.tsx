"use client";

import { C } from "@/components/cat/tokens";

export type PotStateName = "None" | "Open" | "Joining" | "Live" | "ExitRequested" | "Divided" | "Settled" | "Expired";

/** A pot's status in a word or two, and whether it is still in play. */
export const STATUS: Record<PotStateName, { label: string; open: boolean }> = {
  None: { label: "Unknown", open: false },
  Open: { label: "Waiting for a player", open: true },
  Joining: { label: "Joining", open: true },
  Live: { label: "Live", open: true },
  ExitRequested: { label: "Exit being priced", open: true },
  Divided: { label: "Closed: divided", open: false },
  Settled: { label: "Closed: settled by Gemini", open: false },
  Expired: { label: "Closed: deposits back", open: false },
};

export const isInPlay = (state: string) => STATUS[state as PotStateName]?.open ?? false;

/** A status badge: filled for live, outlined while waiting, muted once closed. */
export function StatusBadge({ state, rope }: { state: string; rope?: boolean }) {
  const s = STATUS[state as PotStateName] ?? STATUS.None;
  const live = state === "Live";
  const busy = state === "Joining" || state === "ExitRequested";
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 10px",
          fontSize: 14,
          fontWeight: 600,
          whiteSpace: "nowrap",
          border: `1.5px solid ${s.open ? C.ink : C.muted}`,
          background: live ? C.ink : busy ? C.faint : "transparent",
          color: live ? C.page : s.open ? C.ink : C.muted,
        }}
      >
        {s.open && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: live ? C.signal : busy ? C.signal : C.ink }} />}
        {s.label}
      </span>
      {rope && <span style={{ padding: "2px 8px", fontSize: 13, border: `1.5px dashed ${C.ink}` }}>Short rope</span>}
    </span>
  );
}

/**
 * What state the pot is in, said to this viewer, with what they can do now (the buttons below follow
 * the same state, so a closed pot never offers an action that no longer applies).
 */
export function PotStatusLine({ state, mySide, exitSide, exitFull, leaverName, rope, v2 }: { state: string; mySide: number | null; exitSide: number | null; exitFull: boolean; leaverName: string; rope?: boolean; /** v2 pots have no takeover. */ v2?: boolean }) {
  const mine = mySide !== null;
  const text: Record<string, string> = {
    Open: mine ? "Waiting for a player to take the other side. Share the link below, or take your offer back." : "Open: you can take the other side below.",
    Joining: "A player is joining. The entry price is being measured over 30 seconds.",
    Live: mine
      ? `Live: your share follows the price.${rope ? " The rope ends at a post or at its expiry." : ""} You can leave or shake hands below.`
      : "Live between two players.",
    ExitRequested:
      mine && exitSide === mySide
        ? "Your exit is being priced over 30 seconds. Nothing else is needed from you."
        : mine
          ? `${leaverName} asked to ${exitFull ? "leave" : "take part of the pot off the rope"}; the price is being measured. You stay in.`
          : exitFull
            ? rope || v2
              ? "A side is leaving; the price is being measured over 30 seconds."
              : "A side is leaving. You can take over its place below while the window is open."
            : "A side is taking part of the pot off the rope.",
    Divided: mine ? "Closed: the pot was divided. See below what you received, and what you would have now if you had stayed." : "Closed: the pot was divided.",
    Settled: mine ? "Closed: Gemini settled the market and the pot was paid out." : "Closed: Gemini settled the market.",
    Expired: mine ? "Closed: the deposits went back." : "Closed: the deposits went back.",
  };
  return (
    <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", borderLeft: `4px solid ${isInPlay(state) ? C.signal : C.muted}`, padding: "6px 0 6px 12px" }}>
      <StatusBadge state={state} rope={rope} />
      <span style={{ fontSize: 17, lineHeight: 1.45 }}>{text[state] ?? ""}</span>
    </div>
  );
}
