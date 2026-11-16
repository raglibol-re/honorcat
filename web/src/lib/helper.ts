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
