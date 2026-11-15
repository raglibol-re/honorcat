"use client";

import { GeminiCredit } from "./Markets";
import { C, F } from "./tokens";

const money = (x: number) => `$${x.toFixed(2)}`;

/**
 * What the promise costs today: payout total times the market's current chance for the pot's side
 * (midpoint of Gemini's best buy and sell). It is what the same promise would cost to buy as
 * contracts right now, so it moves with the market. Information only: HonorCat places no orders.
 */
export function CostView({ total, chance, side }: { total: number; chance: number | null; side: "yes" | "no" }) {
  const cost = chance === null ? null : total * chance;
  return (
    <section aria-label="What this promise costs today" style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.faint}`, paddingTop: 12 }}>
      <span style={{ fontSize: 15, color: C.muted }}>What this promise costs today (estimate)</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: F.cond, fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{cost === null ? "–" : money(cost)}</span>
        <span style={{ fontSize: 14, color: C.muted }}>
          {money(total)} × {chance === null ? "–" : `${Math.round(chance * 100)}%`} chance of “{side}” now
        </span>
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: C.muted }}>
        Based on the current market price (middle of Gemini’s best buy and sell); it moves with the market. In the US, this cost could be hedged by buying the same
        contract on Gemini. Information only.
      </span>
      <GeminiCredit />
    </section>
  );
}

const RULES = {
  demo: { name: "Demo rule", window: "1 minute", every: "2 seconds", valid: 25, spread: "4¢", size: 10, age: "10 seconds" },
  standard: { name: "Standard rule", window: "30 minutes", every: "10 seconds", valid: 150, spread: "5¢", size: 50, age: "60 seconds" },
} as const;

/** The trigger rule a new pot gets (fixed at creation), in one paragraph. */
export function RuleSummary({ profile, threshold }: { profile: "demo" | "standard"; threshold: number }) {
  const r = RULES[profile];
  return (
    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: C.muted }}>
      <strong style={{ color: C.ink }}>{r.name}</strong>
      {profile === "demo" ? " (the market closes within two hours, or this is a demo)" : " (more than two hours to close)"}: three independent checks read the order
      book every {r.every}. The chance must average {threshold}% or more over {r.window}, from at least {r.valid} valid readings. A reading counts only when the
      spread is {r.spread} or less, both sides show at least {r.size} contracts and the data is under {r.age} old. Fixed when you fund. An early payout is final;
      the market can be wrong.
    </p>
  );
}
