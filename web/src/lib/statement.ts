/**
 * A market as a plain statement and its opposite, for the interface instead of YES and NO:
 * "Cleveland beats Chicago" and "Cleveland does not beat Chicago". YES is the statement, NO its
 * opposite. Pure (no imports) so the relay's tests can check it.
 */
export type StatementInput = { eventTitle: string; label: string; teams?: string | null; yesMeans?: string | null };
export type Sides = {
  /** What YES stands for, as a statement. */
  yes: string;
  /** What NO stands for: the statement's opposite. */
  no: string;
  /** Short names for tight places (the rope's posts, buttons). */
  yesShort: string;
  noShort: string;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Chicago vs Cleveland: Point Spread" -> ["Chicago", "Cleveland"]. */
function teamsOfTitle(title: string): [string, string] | null {
  const t = title.replace(/:.*$/, "").split(/\s+(?:vs\.?|at|@)\s+/i);
  return t.length === 2 ? [t[0]!.trim(), t[1]!.trim()] : null;
}

/** Turns "X wins by more than 9.5 points" into its opposite, and the like. */
function negate(s: string): string | null {
  const rules: [RegExp, string][] = [
    [/^(.+?) wins by more than (.+)$/i, "$1 does not win by more than $2"],
    [/^(.+?) wins (.+)$/i, "$1 does not win $2"],
    [/^(.+?) wins$/i, "$1 does not win"],
    [/^(.+?) beats (.+)$/i, "$1 does not beat $2"],
    [/^(.+?) is above (.+)$/i, "$1 is not above $2"],
    [/^(.+?) is at or above (.+)$/i, "$1 is below $2"],
    [/^(.+?) is greater than or equal to (.+)$/i, "$1 is less than $2"],
    [/^(.+?) will (.+)$/i, "$1 will not $2"],
  ];
  for (const [re, to] of rules) if (re.test(s)) return s.replace(re, to);
  return null;
}

/**
 * Gemini shortens some teams to a city and a letter ("Los Angeles C", "New York R"); the game's
 * full team names ("Los Angeles Chargers at Baltimore Ravens") say which one.
 */
/** Full team names seen anywhere in this page's data, for events that carry only the short ones. */
const knownTeams = new Set<string>();
export function rememberTeams(teams: (string | null | undefined)[]) {
  for (const t of teams) if (t) for (const one of t.split(/\s+(?:at|vs\.?|@)\s+/i)) if (one.trim() && !/\s[A-Z]$/.test(one.trim())) knownTeams.add(one.trim());
}

function fullName(short: string, teams: string | null | undefined): string {
  if (!/\s[A-Z]$/.test(short)) return short;
  // Only a genuinely longer name counts: some events list the short form as their teams too.
  const longer = (t: string) => t.startsWith(short) && t.length > short.length;
  const hit = (teams ?? "").split(/\s+(?:at|vs\.?|@)\s+/i).find(longer) ?? [...knownTeams].find(longer);
  return hit ?? short;
}

/**
 * Replaces every abbreviated team ("Los Angeles C") in a label or title with its full name, also
 * inside longer text ("Los Angeles C wins by more than 1.5 points").
 */
export function expandTeams(text: string, eventTitle: string, teams: string | null | undefined): string {
  const parts = teamsOfTitle(eventTitle) ?? [];
  let out = text;
  for (const short of parts) {
    const full = fullName(short, teams);
    if (full === short) continue;
    const esc = short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`${esc}(?![A-Za-z])`, "g"), full);
  }
  return out;
}

/** A market's result label with full team names (for lists that show the label itself). */
export const fullLabel = (m: StatementInput) => expandTeams(m.label, m.eventTitle, m.teams);

export function sidesOf(input: StatementInput): Sides {
  // Abbreviated teams become full names everywhere before anything is phrased.
  const m = { ...input, label: expandTeams(input.label, input.eventTitle, input.teams), eventTitle: expandTeams(input.eventTitle, input.eventTitle, input.teams) };
  const label = fullName(m.label.trim(), m.teams);
  const raw = teamsOfTitle(m.eventTitle);
  const pair: [string, string] | null = raw ? [fullName(raw[0], m.teams), fullName(raw[1], m.teams)] : null;
  // A draw.
  if (/^(tie|draw)$/i.test(label)) {
    const g = pair ? `${pair[0]} and ${pair[1]} draw` : "The game ends in a draw";
    return { yes: g, no: pair ? `${pair[0]} and ${pair[1]} do not draw` : "The game does not end in a draw", yesShort: "Draw", noShort: "No draw" };
  }
  // A spread, total or other label that is already a sentence.
  const said = /^\d/.test(label) ? null : negate(label);
  if (said && /\s/.test(label)) return { yes: cap(label), no: cap(said), yesShort: cap(label), noShort: cap(said) };
  // A winner: the label is one of the two teams.
  if (pair) {
    const i = pair.findIndex((p) => p.toLowerCase() === label.toLowerCase());
    if (i >= 0) {
      const other = pair[1 - i]!;
      return { yes: `${label} beats ${other}`, no: `${label} does not beat ${other}`, yesShort: `${label} wins`, noShort: `${label} does not win` };
    }
  }
  // Crypto "Up": the price ends at or above Gemini's reference.
  const price = m.yesMeans?.match(/^the price of (.+?) is greater than or equal to/i);
  if (price) {
    const asset = price[1]!;
    return { yes: `${asset} ends at or above its reference price`, no: `${asset} ends below its reference price`, yesShort: `${asset} up`, noShort: `${asset} down` };
  }
  // Anything else: the event and the result, and its opposite.
  return { yes: `${m.eventTitle.replace(/:.*$/, "")}: ${label}`, no: `${m.eventTitle.replace(/:.*$/, "")}: not ${label}`, yesShort: label, noShort: `Not ${label}` };
}

/** The statement a side (0 = YES, 1 = NO) stands for. */
export const sideStatement = (s: Sides, side: number) => (side === 0 ? s.yes : s.no);
export const sideShort = (s: Sides, side: number) => (side === 0 ? s.yesShort : s.noShort);
