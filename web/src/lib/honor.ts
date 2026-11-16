/**
 * Plain labels for an honor record, read straight from its facts (no score, nothing invented).
 * Each label says which facts it comes from. Pure, so the relay's tests check it.
 */
export type HonorFacts = { pots: number; heldToEnd: number; exits: number; exitsByNet: number; exitsByBowl: number; handshakes: number; tookOver: number; takenOver: number };

export function honorLabels(r: HonorFacts): { label: string; because: string }[] {
  if (r.pots === 0) return [{ label: "New here", because: "no pots played yet (practice pots do not count)" }];
  const out: { label: string; because: string }[] = [];
  const share = (x: number) => x / r.pots;
  const of = (x: number, what: string) => `${what} in ${x} of ${r.pots} pot${r.pots === 1 ? "" : "s"}`;
  if (share(r.heldToEnd) >= 0.6) out.push({ label: "Holds to the end", because: of(r.heldToEnd, "held to Gemini's result") });
  if (r.handshakes > 0 && share(r.handshakes) >= 0.3) out.push({ label: "Often splits by handshake", because: of(r.handshakes, "shook hands") });
  if (share(r.exits) >= 0.5) out.push({ label: "Often leaves early", because: of(r.exits, "left before the result") });
  if (r.exitsByNet > 0) out.push({ label: "Plays with a net", because: `${r.exitsByNet} exit${r.exitsByNet === 1 ? "" : "s"} filed by a net` });
  if (r.exitsByBowl > 0) out.push({ label: "Takes the bowl", because: `${r.exitsByBowl} exit${r.exitsByBowl === 1 ? "" : "s"} filed by a bowl` });
  if (r.tookOver > 0) out.push({ label: "Steps in for others", because: `took over ${r.tookOver} side${r.tookOver === 1 ? "" : "s"}` });
  if (!out.length) out.push({ label: "Plays every way", because: "no single habit in the facts yet" });
  return out;
}
