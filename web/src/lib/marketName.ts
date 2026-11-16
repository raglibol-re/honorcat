import { PAGE_LOCALE } from "./format";

type Named = { eventTitle: string; label: string; league?: string | null; teams?: string | null; startMs?: number | null; closeMs?: number | null; yesMeans?: string | null };

const day = (ms: number) =>
  new Date(ms).toLocaleString(PAGE_LOCALE, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "NBA · Orlando Magic at Boston Celtics · Mon, Nov 17, 1:00 AM": league, both teams, date. */
export function marketLine(m: Named): string {
  const when = m.startMs ?? m.closeMs ?? null;
  return [m.league, m.teams ?? m.eventTitle, when ? day(when) : null].filter(Boolean).join(" · ");
}

/** What YES means, in plain words, from the contract's own rule; else from its label. */
export function yesMeans(m: Named): string {
  if (m.yesMeans) return m.yesMeans.charAt(0).toUpperCase() + m.yesMeans.slice(1);
  return `${m.label} (${m.eventTitle})`;
}

/** The short title for headings: both teams (or the event) and the result YES stands for. */
export function marketTitle(m: Named): string {
  return `${m.teams ?? m.eventTitle}: ${m.label}`;
}
