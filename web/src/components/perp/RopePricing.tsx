"use client";

import { C } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { useNow } from "@/lib/useNow";

type Pricing = {
  what: "join" | "exit" | "post" | "expiry";
  state: "measuring" | "sending" | "recorded" | "no-price";
  windowStart: number;
  windowEnd: number;
  reported: number;
  validReports: number;
  samplers: number;
  priceYes: number | null;
  updatedAt: number;
};

const WHAT: Record<Pricing["what"], string> = {
  join: "the rope's starting price",
  exit: "the price for leaving",
  post: "a knock-out: the price is past a post",
  expiry: "the rope's end price",
};
const pts = (ppm: number) => (ppm / 10_000).toFixed(1);

/** How long after a rope's end (seconds) a still-running rope counts as delayed. */
export const DELAY_AFTER_S = 150;

/**
 * A live line while a rope is being priced: the 30-second window filling up, then the samplers
 * reporting, then the price on its way to Arc. When a rope runs well past its end, a calm notice
 * says why and that the money stays in the contract.
 */
export function RopePricing({
  potId,
  expiry,
  leaving,
  expiryTries = 0,
}: {
  potId: string;
  expiry: number;
  leaving: boolean;
  /** Failed end-price windows so far; after four the rope waits for the market's result. */
  expiryTries?: number;
}) {
  const now = Math.floor(useNow() / 1000);
  const late = expiry > 0 && now - expiry > DELAY_AFTER_S;
  const { data } = usePolling<{ pricing: Pricing | null }>(`/api/hc/pots/${potId}/pricing`, 2000);
  const p = data?.pricing ?? null;
  // A recorded or failed check older than a minute is history, not progress.
  const fresh = p && (p.state === "measuring" || p.state === "sending" || now - p.updatedAt < 60);

  return (
    <>
      {fresh && p && <Line p={p} now={now} />}
      {expiryTries >= 4 ? (
        <p
          role="status"
          style={{ margin: 0, padding: "10px 14px", border: `1.5px solid ${C.ink}`, fontSize: 16, lineHeight: 1.45, background: C.panel }}
        >
          <strong>This rope now ends with the market&apos;s result.</strong> Four price checks after its end gave no
          price (Gemini&apos;s order book was too wide or thin), so, as the contract says, it is paid out on the result
          once Gemini settles the market. Your money stays in the contract until then; nothing is lost.
        </p>
      ) : (late || (leaving && p?.state === "no-price")) && (
        <p
          role="status"
          style={{ margin: 0, padding: "10px 14px", border: `1.5px solid ${C.ink}`, fontSize: 16, lineHeight: 1.45, background: C.panel }}
        >
          <strong>This is taking longer than usual.</strong> A rope ends only on a price the samplers agree on, and
          Gemini&apos;s order book has been too wide or thin to give one. They try again every few seconds. Your money
          stays in the contract meanwhile; nothing is lost.
        </p>
      )}
    </>
  );
}

function Line({ p, now }: { p: Pricing; now: number }) {
  const span = Math.max(1, p.windowEnd - p.windowStart);
  const into = Math.min(span, Math.max(0, now - p.windowStart));
  const head =
    p.state === "measuring" && now < p.windowEnd
      ? `Measuring ${WHAT[p.what]}`
      : p.state === "measuring"
        ? `Waiting for the samplers: ${p.reported} of ${p.samplers} reported`
        : p.state === "sending"
          ? `The samplers agree${p.priceYes !== null ? ` on ${pts(p.priceYes)}` : ""}: recording it on Arc`
          : p.state === "recorded"
            ? `Recorded on Arc${p.priceYes !== null ? `: ${pts(p.priceYes)}` : ""}`
            : "No price this time (the order book was too wide or thin); trying again";
  const pct = p.state === "measuring" && now < p.windowEnd ? (into / span) * 100 : p.state === "no-price" ? 0 : 100;
  return (
    <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="hc-progress">
        <b>Price check</b>
        <span>{head}</span>
        {p.state === "measuring" && now < p.windowEnd && (
          <span className="hc-progress__t">
            {into} s of {span}
          </span>
        )}
      </span>
      <span aria-hidden style={{ display: "block", height: 6, background: C.grid }}>
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${pct}%`,
            background: p.state === "no-price" ? C.dash : p.what === "post" ? C.signal : C.ink,
            transition: "width 900ms linear",
          }}
        />
      </span>
    </div>
  );
}
