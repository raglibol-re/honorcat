"use client";

import { C, F } from "@/components/cat/tokens";
import { rateText, setHome, useHome, type Home } from "@/lib/currency";
import { formatClock } from "@/lib/format";

const OPTIONS: { home: Home; label: string }[] = [
  { home: "USDC", label: "$ Dollars (USDC)" },
  { home: "EURC", label: "€ Euros (EURC)" },
];

/** Choose the currency amounts are shown in. */
export function CurrencySwitch() {
  const { home } = useHome();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span id="home-currency" style={{ fontSize: 15, color: C.body }}>
        Show amounts in
      </span>
      <div role="radiogroup" aria-labelledby="home-currency" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {OPTIONS.map((o) => {
          const on = home === o.home;
          return (
            <button
              key={o.home}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setHome(o.home)}
              style={{ minHeight: 44, padding: "0 16px", fontFamily: F.sans, fontSize: 16, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${C.ink}`, background: on ? C.ink : "transparent", color: on ? C.page : C.ink }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <RateNote always />
    </div>
  );
}

/**
 * The rate behind euro amounts, said once near them: shown only while euros are chosen
 * (or always, under the switch).
 */
export function RateNote({ always = false }: { always?: boolean }) {
  const { home, rate } = useHome();
  if (home !== "EURC") return always ? <p style={note}>Pots hold and pay test USDC, a dollar stablecoin.</p> : null;
  if (!rate) return <p style={note}>Looking up the euro rate… until then, amounts are in dollars (USDC).</p>;
  return (
    <p style={note}>
      Euro amounts at {rateText(rate)} (Circle Swap Kit rate on Arc, {formatClock(rate.fetchedAt)}). Pots still hold and pay test USDC; euro payouts come later.
    </p>
  );
}

const note: React.CSSProperties = { margin: 0, fontSize: 14, color: C.muted, lineHeight: 1.45 };
