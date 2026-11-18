"use client";

import { C, F } from "@/components/cat/tokens";
import { txUrl } from "@/lib/chain";
import { money3 } from "@/lib/currency";
import type { DivisionReceipt } from "@/lib/divisionReceipt";
import { cents, took } from "@/lib/receipts";

const pc = (ppm: number) => `${(ppm / 10_000).toFixed(1)}%`;

/** One paw: filled for a life left, outlined for one used. */
function Paw({ on }: { on: boolean }) {
  return (
    <svg viewBox="-9 -11 18 18" width="18" height="18" aria-hidden="true" style={{ display: "block" }}>
      <g fill={on ? C.ink : "none"} stroke={C.ink} strokeWidth="1.2">
        <ellipse cx="0" cy="3" rx="5.4" ry="4.4" />
        <circle cx="-5.6" cy="-3.6" r="2.1" />
        <circle cx="-2" cy="-7" r="2.1" />
        <circle cx="2.1" cy="-7" r="2.1" />
        <circle cx="5.8" cy="-3.6" r="2.1" />
      </g>
    </svg>
  );
}

/**
 * The receipt of an exit, for the viewer: who took how much off the rope, the slice split at the exit
 * price into both players' parts (in their colours), what the viewer's side got and why, what is
 * still on the rope and the lives left. Timing, network fee and the payout on Arc in one line below.
 */
export function DivisionCard({
  r,
  mySide,
  name,
  fur,
  fee,
  livePrice = null,
  posts = [0, 1],
}: {
  r: DivisionReceipt;
  mySide: number | null;
  name: (side: number) => string;
  /** Each side's fur colour (hex). */
  fur: (side: number) => string;
  /** The network fee of the payout transaction, in USDC base units, if known. */
  fee: string | undefined;
  /** The live YES price (0..1), for what the leaver's slice would be worth had it stayed. */
  livePrice?: number | null;
  /** The posts (0..1); a normal pot is [0, 1]. */
  posts?: [number, number];
}) {
  const leaver = r.exitSide;
  const other = (1 - leaver) as 0 | 1;
  const amount = (v: bigint) => money3(v);
  const what = r.full ? "left the rope" : `took ${r.fraction} off the rope`;
  const headline = mySide === leaver ? `You ${what}` : `${name(leaver)} ${what}`;
  const yesColor = fur(0);
  const noColor = fur(1) === fur(0) ? C.signal : fur(1);
  const share = (s: 0 | 1) => (r.slice > 0n ? Number(r.part[s]) / Number(r.slice) : 0.5);
  const row = (label: string, v: string, strong = false) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0", borderTop: strong ? `1.5px solid ${C.ink}` : `1px solid ${C.faint}`, fontSize: strong ? 20 : 17, fontWeight: strong ? 600 : 400 }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
  const lines =
    mySide === leaver
      ? [row("Your part of the slice", amount(r.part[leaver])), row(`Treat to ${name(other)}`, `− ${amount(r.treat)}`), row("You received", amount(r.received[leaver]), true)]
      : mySide === other
        ? [row("Your part back", amount(r.part[other])), row(`Plus the treat from ${name(leaver)}`, `+ ${amount(r.treat)}`), row("You received", amount(r.received[other]), true)]
        : [row(`${name(leaver)} received`, amount(r.received[leaver])), row(`${name(other)} received (with a ${amount(r.treat)} treat)`, amount(r.received[other]))];
  return (
    <article aria-label={headline} style={{ display: "flex", flexDirection: "column", gap: 14, border: `2px solid ${C.ink}`, padding: "16px 18px", maxWidth: 680 }}>
      <h3 style={{ margin: 0, fontFamily: F.cond, fontSize: 30, fontWeight: 600, lineHeight: 1.05 }}>{headline}</h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.body }}>
          <span>
            The slice: <strong style={{ color: C.ink }}>{amount(r.slice)}</strong>
          </span>
          <span>divided at {pc(r.price)}</span>
        </div>
        <div role="img" aria-label={`${name(0)}'s part ${amount(r.part[0])}, ${name(1)}'s part ${amount(r.part[1])}`} style={{ display: "flex", height: 26, border: `1.5px solid ${C.ink}` }}>
          <div style={{ width: `${share(0) * 100}%`, background: yesColor }} />
          <div style={{ width: `${share(1) * 100}%`, background: noColor }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15 }}>
          <span>
            {name(0)}: <strong>{amount(r.part[0])}</strong>
          </span>
          <span style={{ textAlign: "right" }}>
            {name(1)}: <strong>{amount(r.part[1])}</strong>
          </span>
        </div>
      </div>

      <div>{lines}</div>

      {mySide === leaver && livePrice !== null && (() => {
        // What the slice would be worth now, at the live price (clamped to the posts), had it stayed.
        const [lo, hi] = posts;
        const yesFrac = (Math.min(hi, Math.max(lo, livePrice)) - lo) / Math.max(1e-9, hi - lo);
        const stayed = BigInt(Math.round(Number(r.slice) * (leaver === 0 ? yesFrac : 1 - yesFrac)));
        const diff = stayed - r.received[leaver];
        return (
          <p aria-live="polite" style={{ margin: 0, fontSize: 16, lineHeight: 1.5, background: C.faint, padding: "8px 12px" }}>
            <strong>If you had stayed:</strong> this slice would be worth about {amount(stayed)} now, at {pc(Math.round(livePrice * 1e6))} (live).{" "}
            {diff > 0n ? `Staying would have given you ${amount(diff)} more so far.` : diff < 0n ? `Leaving saved you ${amount(-diff)} so far.` : "The same as you received."}
          </p>
        );
      })()}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 36px" }}>
        <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <figcaption style={{ fontSize: 13, color: C.muted }}>Still on the rope</figcaption>
          <span style={{ fontFamily: F.cond, fontSize: 26, fontWeight: 600 }}>
            {amount(r.potAfter)} <span style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 400, color: C.muted }}>was {amount(r.potBefore)}</span>
          </span>
        </figure>
        {r.livesLeft !== null && (
          <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <figcaption style={{ fontSize: 13, color: C.muted }}>
              Lives left: {r.livesLeft} of 9
            </figcaption>
            <span style={{ display: "flex", gap: 3 }}>
              {Array.from({ length: 9 }, (_, i) => (
                <Paw key={i} on={i < r.livesLeft!} />
              ))}
            </span>
          </figure>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
        {r.tookS !== null && r.tookS > 0 ? `Paid ${took(0, r.tookS)} after the request · ` : ""}
        {cents(fee) ? `Arc network fee ${cents(fee)}, paid by HonorCat · ` : ""}
        <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" style={{ color: C.muted }}>
          the payout on Arc
        </a>
      </p>
    </article>
  );
}
