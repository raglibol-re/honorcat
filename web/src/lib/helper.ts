import { formatAmount } from "./amount";
/**
 * The helper cat's words (docs/grokcat-spec.md, role 2 "options in words"). Pure: our code supplies
 * every number, already formatted; the sentences only place them. Nothing here recommends a side or
 * an action. `adviceFree` and `numbersFrom` are the output checks every helper sentence must pass,
 * whoever wrote it (these templates now, Grok later).
 */
export type ExitOptionsInput = {
  /** What leaving would pay now, after the fee, formatted ("$0.49"). */
  leaveAbout: string;
  /** The fee (the treat for the other cat), formatted. */
  fee: string;
  /** The whole pot, formatted. */
  pot: string;
  /** The statement the player holds ("Boston beats Orlando"). */
  mine: string;
  /** The other player's name. */
  other: string;
  /** The current chance, formatted ("76.5%"). */
  chance: string;
  /** Whether this is a partial exit (and of how much, formatted). */
  part?: string | null;
};

export function exitOptions(i: ExitOptionsInput): string[] {
  return [
    i.part
      ? `Leaving with ${i.part}: about ${i.leaveAbout} for you after a ${i.fee} treat for ${i.other}; the rest of the pot stays live. The final amount is set by the next 30 seconds and cannot be taken back.`
      : `Leaving: about ${i.leaveAbout} for you after a ${i.fee} treat for ${i.other}. The final amount is set by the next 30 seconds and cannot be taken back.`,
    `Staying: when Gemini settles, you get ${i.pot} if ${i.mine}, and nothing if not.`,
    `Shaking hands: if ${i.other} agrees, the pot splits now at ${i.chance} with no treat.`,
  ];
}

/** Phrases that would tell a player what to do. The helper cat informs; it never advises. */
const ADVICE = /\b(you should|i (would )?(recommend|suggest|advise)|my advice|better to|best to|don'?t leave|stay in|take the (yes|no)|buy|sell|go for it|i'?d (leave|stay|hold))\b/i;
export const adviceFree = (text: string) => !ADVICE.test(text);

/** Every number in `text` (amounts, percentages, plain numbers), as written. */
export const numbersIn = (text: string) => text.match(/\$?\d+(?:[.,]\d+)*%?/g) ?? [];

/** True when every number in `text` appears in the supplied values (the context our code gave). */
export const numbersFrom = (text: string, supplied: string[]) => {
  const ok = new Set(supplied.flatMap((s) => numbersIn(s)));
  return numbersIn(text).every((n) => ok.has(n));
};

/* ------------------------------------------------------------------ nets and bowls in words */

export type LevelsInput = { own: number; shareNow: string; net: number | null; bowl: number | null };

/** One sentence each on what a net and a bowl would do for this player, with our own numbers. */
export function levelOptions(i: LevelsInput): string[] {
  const pct = (x: number) => `${x.toFixed(0)}%`;
  return [
    `Your side is at ${pct(i.own * 100)} now, so your share is about ${i.shareNow}.`,
    i.net
      ? `A net at ${pct(i.net)}: if your side's 30-second average holds at or below it for a full window, your exit is filed and priced like any other.`
      : "A net is a floor for your side: when its price falls to it, your exit is filed for you.",
    i.bowl
      ? `A bowl at ${pct(i.bowl)}: if your side's average holds at or above it, your share comes off the rope.`
      : "A bowl is a target: when your side's price rises to it, your share comes off the rope.",
  ];
}

/* ------------------------------------------------------------------ wishes in plain words */

export type Wish = { kind: "net" | "bowl"; percent: number; why: string } | { kind: "none"; why: string };

/**
 * Turns a plain wish into a net or bowl the player can confirm. Our own numbers only: `own` is the
 * side's chance now (0..1) and `pot` the pot in dollars. Never decides for the player; returns
 * "none" with a reason when the wish is unclear or not possible.
 */
export function readWish(text: string, own: number, pot: number): Wish {
  const t = text.toLowerCase().replace(/(\d),(\d)/g, "$1.$2");
  const share = own * pot;
  const num = (re: RegExp) => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };
  const clamp = (p: number) => Math.min(99, Math.max(1, Math.round(p)));
  // "protect half my stake", "keep 60% of my share"
  if (/(protect|keep|guard|save)/.test(t)) {
    const keep = /half/.test(t) ? 50 : num(/(\d+(?:\.\d+)?)\s*%/);
    if (keep) {
      const p = clamp(own * 100 * (keep / 100));
      return { kind: "net", percent: p, why: `A net at ${p}%: if your side falls to it, you leave with about ${formatAmount(((p / 100) * pot))}, ${keep}% of today's ${formatAmount(share)}.` };
    }
  }
  // "take my share off at $8.50", "cash out at 8 dollars"
  const dollars = num(/\$\s*(\d+(?:\.\d+)?)/) ?? num(/(\d+(?:\.\d+)?)\s*(?:dollars|usd|usdc)\b/);
  if (dollars !== null) {
    const p = Math.round((dollars / pot) * 100);
    if (p <= own * 100) return { kind: "none", why: `Your share is about ${formatAmount(share)} already; a bowl must sit above today's ${Math.round(own * 100)}%.` };
    if (p >= 100) return { kind: "none", why: `The whole pot is ${formatAmount(pot)}, so a share of ${formatAmount(dollars)} cannot be reached before the result.` };
    return { kind: "bowl", percent: p, why: `A bowl at ${p}%: when your side reaches it, your share of about ${formatAmount(dollars)} comes off the rope.` };
  }
  // "if it drops below 40%", "floor at 40"
  const below = num(/(?:below|under|drops? to|falls? to|floor at|net at)\D*(\d+(?:\.\d+)?)/);
  if (below !== null) {
    const p = clamp(below);
    if (p >= own * 100) return { kind: "none", why: `A net must sit below today's ${Math.round(own * 100)}%.` };
    return { kind: "net", percent: p, why: `A net at ${p}%: your exit is filed if your side falls to it.` };
  }
  // "if it reaches 90%", "take profit at 90"
  const above = num(/(?:reach(?:es)?|above|over|rises? to|hits?|bowl at|profit at|off at)\D*(\d+(?:\.\d+)?)/);
  if (above !== null) {
    const p = clamp(above);
    if (p <= own * 100) return { kind: "none", why: `A bowl must sit above today's ${Math.round(own * 100)}%.` };
    return { kind: "bowl", percent: p, why: `A bowl at ${p}%: your share comes off the rope if your side reaches it.` };
  }
  return { kind: "none", why: "I could not read a net or a bowl in that. Try “protect half my stake” or “take my share off at 85%”." };
}
