/**
 * The receipt of an exit (full or partial), as numbers: the slice taken off the rope, each side's part
 * of it at the exit price, the treat, what each side received, what is still on the rope and the lives
 * left. Pure: the relay's tests check that both receipts add up to the slice and that the pot that is
 * left is the old pot minus the slice. Every number comes from the pot's own events.
 */
import type { ReceiptEvent } from "./receipts";

export type DivisionReceipt = {
  tx: string;
  at: number | null;
  tookS: number | null;
  exitSide: 0 | 1;
  price: number; // ppm
  /** The slice divided, in USDC base units (paidYes + paidNo). */
  slice: bigint;
  potBefore: bigint;
  potAfter: bigint;
  full: boolean;
  /** "one ninth", "a third", "42%" of the pot before. */
  fraction: string;
  /** Each side's part of the slice at the exit price, before the treat. */
  part: [bigint, bigint];
  /** The treat (exit fee) the leaving side gave the other side. */
  treat: bigint;
  /** What each side received. */
  received: [bigint, bigint];
  /** Lives left out of nine (the pot left, in ninths of the pot at the start), null when unknown. */
  livesLeft: number | null;
};

const WORDS: Record<string, string> = {
  "1/9": "one ninth", "2/9": "two ninths", "1/3": "a third", "4/9": "four ninths", "5/9": "five ninths",
  "2/3": "two thirds", "7/9": "seven ninths", "8/9": "eight ninths", "1/2": "half", "1/4": "a quarter", "3/4": "three quarters",
};

/** The real fraction in words when it is a simple one (ninths first: nine lives), else a percentage. */
export function fractionWords(slice: bigint, of: bigint): string {
  if (of <= 0n) return "part";
  const f = Number(slice) / Number(of);
  for (const n of [9, 3, 2, 4]) {
    const k = Math.round(f * n);
    if (k > 0 && k < n && Math.abs(f - k / n) < 0.004) {
      const g = gcd(k, n);
      const w = WORDS[`${k / g}/${n / g}`];
      if (w) return w;
    }
  }
  return `${Math.round(f * 100)}%`;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Every exit of the pot (not handshakes, which have their own receipt), in order. */
export function divisionReceipts(events: ReceiptEvent[]): DivisionReceipt[] {
  const out: DivisionReceipt[] = [];
  let pot: bigint | null = null; // the value on the rope
  let initial: bigint | null = null;
  let requestedAt: number | null = null;
  let exitingSide: 0 | 1 = 0;
  const handshakeTx = new Set(events.filter((e) => e.name === "Handshake").map((e) => e.tx));
  for (const e of events) {
    const g = e.args;
    switch (e.name) {
      case "PotCreated":
        if (g.notional !== undefined) pot = BigInt(g.notional); // v1: the pot size
        break;
      case "Joined":
        if (g.depYes !== undefined && g.depNo !== undefined) pot = BigInt(g.depYes) + BigInt(g.depNo);
        initial ??= pot;
        break;
      case "ExtraLife":
        if (pot !== null) pot += BigInt(g.paid ?? "0");
        break;
      case "ExitRequested":
        requestedAt = e.at;
        exitingSide = Number(g.side ?? 0) === 1 ? 1 : 0;
        break;
      case "KnockOutTriggered":
        requestedAt = e.at;
        exitingSide = Number(g.knockedSide ?? 0) === 1 ? 1 : 0;
        break;
      case "PotDivided": {
        const paid: [bigint, bigint] = [BigInt(g.paidYes ?? "0"), BigInt(g.paidNo ?? "0")];
        const slice = paid[0] + paid[1];
        if (handshakeTx.has(e.tx) || g.reason === "3") {
          if (pot !== null) pot -= slice;
          break;
        }
        const side: 0 | 1 = g.exitSide !== undefined ? (Number(g.exitSide) === 1 ? 1 : 0) : exitingSide;
        const treat = BigInt(g.fee ?? "0");
        const part: [bigint, bigint] = side === 0 ? [paid[0] + treat, paid[1] - treat] : [paid[0] - treat, paid[1] + treat];
        const before: bigint = pot ?? slice;
        const after: bigint = before - slice;
        out.push({
          tx: e.tx,
          at: e.at,
          tookS: requestedAt !== null && e.at !== null ? e.at - requestedAt : null,
          exitSide: side,
          price: Number(g.price ?? 0),
          slice,
          potBefore: before,
          potAfter: after,
          full: after === 0n,
          fraction: fractionWords(slice, before),
          part,
          treat,
          received: paid,
          livesLeft: initial && initial > 0n ? Math.max(0, Math.min(9, Math.round((9 * Number(after)) / Number(initial)))) : null,
        });
        pot = after;
        requestedAt = null;
        break;
      }
    }
  }
  return out;
}
