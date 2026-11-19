"use client";

import { Notice } from "@/components/ui/Field";
import { usePolling } from "@/lib/api";
import type { ActorState } from "./Who";

/** After this many pots and perps started within three hours, the create pages suggest a break. */
const BREAK_AFTER = 5;

/**
 * A plain reminder on the create pages after several pots in a row (pots, perps and, later, group
 * joins count). It blocks nothing.
 */
export function BreakReminder({ who }: { who: ActorState }) {
  const me = who.actor?.account ?? null;
  const { data } = usePolling<{ lastThreeHours: number }>(me ? `/api/hc/streaks?account=${me}` : null, 120_000);
  if (!data || data.lastThreeHours < BREAK_AFTER) return null;
  return (
    <Notice tone="warning">
      <strong>You started {data.lastThreeHours} pots and perps in the last three hours.</strong>
      <span>A short break? Running pots keep going without you, and you can leave one at any time.</span>
    </Notice>
  );
}
