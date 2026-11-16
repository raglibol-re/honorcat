import { PAGE_LOCALE } from "./format";
import { sidesOf, type Sides } from "./statement";

export { sidesOf, sideShort, sideStatement, type Sides } from "./statement";

type Named = { eventTitle: string; label: string; league?: string | null; teams?: string | null; startMs?: number | null; closeMs?: number | null; yesMeans?: string | null };

/** A date and time in the reader's own time zone, with the zone named. */
export const localTime = (ms: number) =>
  new Date(ms).toLocaleString(PAGE_LOCALE, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/** "NBA · Chicago Bulls at Cleveland Cavaliers · starts Mon, Nov 17, 1:00 AM GMT+1": league, both teams, local start. */
export function marketLine(m: Named): string {
  const when = m.startMs ? `starts ${localTime(m.startMs)}` : m.closeMs ? `closes ${localTime(m.closeMs)}` : null;
  return [m.league, m.teams ?? m.eventTitle, when].filter(Boolean).join(" · ");
}

/** The market's own rule in plain words (what Gemini settles on); for the technical details. */
export function yesMeans(m: Named): string {
  if (m.yesMeans) return m.yesMeans.charAt(0).toUpperCase() + m.yesMeans.slice(1);
  return `${m.label} (${m.eventTitle})`;
}

/** The market as a plain statement ("Cleveland beats Chicago"): the title everywhere. */
export function marketTitle(m: Named): string {
  return sidesOf(m).yes;
}

/** Both sides of a market. */
export const sides = (m: Named): Sides => sidesOf(m);
