"use client";

import { txUrl } from "@/lib/chain";
import { useTechMode } from "@/components/TechMode";

type Props = {
  play: boolean; // animate step by step (only when the result arrives while watching)
  resultSeenAt: number | null;
  resolvedTx: string;
  resolvedBlock: number;
  refundTx: string | null;
  refundBlock: number | null;
  resultToPaymentMs: number | null;
  triggered: boolean;
};

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

/**
 * The settlement, as three real steps: the relay saw Gemini's result, the vault verified the
 * resolver's EIP-712 signature on Arc, and the money moved. Timings are measured, not decorative.
 */
export function SettlementMoment(p: Props) {
  const { tech } = useTechMode();
  const steps = [
    {
      title: "Result received",
      detail: p.resultSeenAt ? new Date(p.resultSeenAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "from Gemini",
    },
    {
      title: tech ? "Signature verified on Arc" : "Decision recorded",
      detail: tech ? `block #${p.resolvedBlock.toLocaleString("en-US")}` : "checked automatically, no one can change it",
      tx: p.resolvedTx,
    },
    p.triggered
      ? {
          title: tech ? "Refunds sent" : "Refund sent to you",
          detail: tech ? (p.refundBlock ? `block #${p.refundBlock.toLocaleString("en-US")}` : "pending") : "it is in your account",
          tx: p.refundTx ?? undefined,
        }
      : {
          title: tech ? "Deposit returned to the merchant" : "No refund this time",
          detail: tech ? `block #${p.resolvedBlock.toLocaleString("en-US")}` : "the event did not happen, so the merchant keeps the payment",
          tx: p.resolvedTx,
        },
  ];
  return (
    <section aria-label="Settlement" className="hc-ticket px-5 py-4">
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={`flex items-start gap-3 ${p.play ? "hc-chip-in" : ""}`}
            style={p.play ? { animationDelay: `${i * 450}ms` } : undefined}
          >
            <span
              aria-hidden
              className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center"
              style={{ background: "var(--hc-accent)" }}
            >
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M2 5.2 4.1 7.3 8 3" stroke="var(--hc-card)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="flex-1">
              <span className="t-15 block font-medium">{s.title}</span>
              <span className="t-13 block" style={{ color: "var(--hc-muted)" }}>
                {s.detail}
                {tech && s.tx && (
                  <>
                    {", "}
                    <a href={txUrl(s.tx)} target="_blank" rel="noreferrer" className="mono hover:underline">
                      {short(s.tx)}
                    </a>
                  </>
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {p.resultToPaymentMs !== null && (
        <p className="t-13 mt-4 border-t pt-3" style={{ borderColor: "var(--hc-rule)", color: "var(--hc-muted)" }}>
          {p.triggered ? "From result to refund" : "From result to close"}: <span className="mono" style={{ color: "var(--hc-ink)" }}>{(p.resultToPaymentMs / 1000).toFixed(1)} s</span>
        </p>
      )}
    </section>
  );
}
