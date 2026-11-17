/**
 * Arc in plain words: fees in cents, a receipt sentence for every payout, and how long it took.
 * Pure (the relay's tests check it); every number comes from the pot's own events and receipts.
 */
export type ReceiptEvent = { name: string; args: Record<string, string | undefined>; tx: string; at: number | null };

const usd = (base: string | number | bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;
const pc = (ppm: string | number | undefined) => `${(Number(ppm ?? 0) / 10_000).toFixed(1)}%`;

/** A network fee in USDC base units as cents: "0.6¢", "1.2¢", or "$0.03" from three cents up. */
export function cents(units: string | number | bigint | null | undefined): string | null {
  if (units === null || units === undefined) return null;
  const c = Number(units) / 10_000;
  if (!Number.isFinite(c)) return null;
  if (c >= 3) return `$${(c / 100).toFixed(2)}`;
  return `${c < 0.1 ? c.toFixed(2) : c.toFixed(1)}¢`;
}

/** Seconds between two block times, said plainly: "38 seconds", "2 minutes". */
export function took(fromS: number | null, toS: number | null): string | null {
  if (fromS === null || toS === null || toS < fromS) return null;
  const s = toS - fromS;
  return s < 120 ? `${s} second${s === 1 ? "" : "s"}` : `${Math.round(s / 60)} minutes`;
}

export type Receipt = { text: string; tx: string; tookS: number | null; at: number | null };

/**
 * Receipt sentences for the pot's payouts, from the viewer's side when they hold one
 * (`mySide` 0 or 1), else naming both sides. `name(side)` names a side's holder.
 */
export function receiptsOf(events: ReceiptEvent[], mySide: number | null, name: (side: number) => string, says: (side: number) => string): Receipt[] {
  const out: Receipt[] = [];
  let requestedAt: number | null = null;
  for (const e of events) {
    const g = e.args;
    if (e.name === "ExitRequested") requestedAt = e.at;
    if (e.name === "PotDivided") {
      const exitSide = Number(g.exitSide ?? 0);
      const paid = (side: number) => (side === 0 ? g.paidYes : g.paidNo) ?? "0";
      const fee = g.fee ?? "0";
      let text: string;
      if (mySide === exitSide) text = `You left at ${pc(g.price)} and received ${usd(paid(mySide))}.`;
      else if (mySide !== null) text = `${name(exitSide)} left at ${pc(g.price)}; you received ${usd(paid(mySide))}, including a ${usd(fee)} treat.`;
      else text = `${name(exitSide)} left at ${pc(g.price)} and received ${usd(paid(exitSide))}; ${name(1 - exitSide)} received ${usd(paid(1 - exitSide))}.`;
      out.push({ text, tx: e.tx, tookS: requestedAt !== null && e.at !== null ? e.at - requestedAt : null, at: e.at });
      requestedAt = null;
    }
    if (e.name === "Handshake") {
      // The event carries the price and the amount divided; the first side gets amount x price.
      const n = BigInt(g.notional ?? "0");
      const yes = (n * BigInt(g.price ?? "0")) / 1_000_000n;
      const paid = (side: number) => (side === 0 ? yes : n - yes).toString();
      const text =
        mySide !== null
          ? `You shook hands at ${pc(g.price)} and received ${usd(paid(mySide))}, with no fee.`
          : `Both sides shook hands at ${pc(g.price)}: ${name(0)} received ${usd(paid(0))}, ${name(1)} ${usd(paid(1))}.`;
      out.push({ text, tx: e.tx, tookS: 0, at: e.at });
    }
    if (e.name === "PotSettled") {
      const o = Number(g.outcome);
      const paid = (side: number) => (side === 0 ? g.paidYes : g.paidNo) ?? "0";
      const text =
        o === 2
          ? mySide !== null
            ? `Gemini voided the market; you received your ${usd(paid(mySide))} back.`
            : "Gemini voided the market; both deposits went back."
          : mySide !== null
            ? `Gemini's result: ${says(o === 1 ? 0 : 1)}. You received ${usd(paid(mySide))}.`
            : `Gemini's result: ${says(o === 1 ? 0 : 1)}. ${name(o === 1 ? 0 : 1)} received ${usd(paid(o === 1 ? 0 : 1))}.`;
      out.push({ text, tx: e.tx, tookS: null, at: e.at });
    }
  }
  return out;
}
