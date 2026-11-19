/**
 * Honor: collectible points for honorable play (docs/honor.md). Every value is part of a versioned
 * config: recomputing from the same inputs with the same version gives the same balances. A change
 * of any value is a new version, never an edit of an old one.
 *
 * Points are kept in hundredths (centi-points) so halving stays exact enough and deterministic;
 * pages show them with one decimal.
 */
export type HonorConfig = {
  version: number;
  /** holding a normal pot or a perp to its end: per hour held, at most per pot */
  holdPerHour: number;
  holdMaxPerPot: number;
  handshake: number;
  /** an open side of mine is joined (pot or perp) */
  openJoined: number;
  /** taking over a side so the other player can continue */
  takeover: number;
  /** "Well played" after a pot, once per pot */
  goodGame: number;
  /** a referred friend completes their first pot that counts for honor */
  referral: number;
  /** joining a group on the smaller team (groups are not built yet) */
  smallerTeam: number;
  /** playing on consecutive days: per day after the first, at most this many days in a row */
  streakDay: number;
  streakMaxDays: number;
  /** anti-farming */
  minStake: number; // USDC base units, each side
  minDurationS: number; // a pot or perp ending sooner than this after it started earns nothing
  sameCounterpartyWindowS: number; // repeated actions with the same player in this window halve
  trustCounterparties: number; // distinct trusted counterparties needed to earn full honor
  untrustedFactor: number; // honor earned before that (0.5 = half)
  /** before this time (unix s), any counterparty counts for trust (the founding players) */
  trustOpenUntil: number;
};

export const HONOR_V1: HonorConfig = {
  version: 1,
  holdPerHour: 2,
  holdMaxPerPot: 20,
  handshake: 10,
  openJoined: 5,
  takeover: 10,
  goodGame: 1,
  referral: 20,
  smallerTeam: 5,
  streakDay: 3,
  streakMaxDays: 7,
  minStake: 100_000, // $0.10 a side
  minDurationS: 600, // 10 minutes
  sameCounterpartyWindowS: 86_400,
  trustCounterparties: 3,
  untrustedFactor: 0.5,
  trustOpenUntil: Date.UTC(2026, 10, 20) / 1000, // 2026-11-20 00:00 UTC
};

export const HONOR_CONFIGS: Record<number, HonorConfig> = { 1: HONOR_V1 };
export const CURRENT_HONOR = HONOR_V1;

/** Titles at honor thresholds (points), lowest first. */
export const TITLES = [
  { min: 0, title: "Stray" },
  { min: 20, title: "House Cat" },
  { min: 100, title: "Honor Cat" },
  { min: 400, title: "Lion" },
] as const;

/** Cat cosmetics unlocked at honor thresholds (replace the milestone unlocks), lowest first. */
export const HONOR_COSMETICS = [
  { min: 1, wear: "bell", label: "Bell collar" },
  { min: 20, wear: "scarf", label: "Green scarf" },
  { min: 50, wear: "bow", label: "Blue bow tie" },
  { min: 100, wear: "hat", label: "Captain's hat" },
  { min: 250, wear: "crown", label: "Golden crown" },
] as const;

export function titleOf(points: number) {
  return [...TITLES].reverse().find((t) => points >= t.min)!.title;
}

export function honorCosmetics(points: number) {
  const unlocked = HONOR_COSMETICS.filter((c) => points >= c.min);
  const next = HONOR_COSMETICS.find((c) => points < c.min) ?? null;
  return {
    wear: unlocked.at(-1)?.wear ?? null,
    unlocked: unlocked.map((c) => ({ wear: c.wear, label: c.label })),
    next: next ? { wear: next.wear, label: next.label, need: `reach ${next.min} honor`, min: next.min, left: `${Math.max(0, next.min - points).toFixed(1).replace(/\.0$/, "")} honor` } : null,
  };
}
