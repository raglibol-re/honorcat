"use client";

import Link from "next/link";
import { Cat } from "@/components/cat/Cat";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { HcPot } from "@/lib/hc";

const li: React.CSSProperties = { fontSize: 17, lineHeight: 1.55, color: C.body };

/** The plain terms of one pot, filled with its own numbers. */
export function Terms({ id }: { id: string }) {
  const { data: pot } = usePolling<HcPot>(`/api/hc/pots/${id}`, 30_000);
  if (!pot) return <Cat pose="peek" size={140} />;
  const d = pot.data;
  const n = Number((d as { initialNotional?: string }).initialNotional ?? d.notional) / 1e6;
  const fee = Number(d.feeBps) / 100;
  const close = formatDate(Number(d.closeTime) * 1000);
  const deadline = formatDate(Number(d.deadline) * 1000);
  const lockout = Math.max(120, 1 + Number(d.window) + 60);
  const m = pot.market;
  const terms: [string, string][] = [
    ["The question", `${m ? `${m.eventTitle}: ${m.label}` : "A Gemini prediction-market contract"} (Gemini instrument ${m?.instrument ?? "unknown"}). YES holds the side that pays if it happens; NO the side that pays if it does not.`],
    ["The pot", `$${n.toFixed(2)} in test USDC on Arc testnet, both sides together. No real money.`],
    ["The price", `The YES price is the midpoint of Gemini's best bid and ask, counted only when the spread and the sizes at the top of the book pass the market's rule, averaged over time. A single reading never moves money: every price is a ${d.window}-second average of at least ${d.minSamples} valid readings.`],
    ["Who measures", "Three independent samplers read Gemini's public order book on their own and each signs its own average. Three valid averages: the middle one counts. Two: their mean, if they are within half a point; otherwise nothing moves. The pot contract checks two of three signatures."],
    ["Joining", `The joiner puts in its side's worst case within ${(Number(d.tolerance) / 10_000).toFixed(1)} points of ${(Number(d.bandCenter) / 10_000).toFixed(1)}%. The starting shares are set by the ${d.window}-second average that starts right after the join request; any deposit above a side's share is returned at once. If that average is outside the band, or cannot be measured, the join does not happen and the joiner gets everything back.`],
    ["Shares", "While the pot is live, YES's share is the pot times the average YES price, NO's share the rest. Shares are only shown, never booked: money moves only on an exit, a handshake or the settlement."],
    ["Leaving", `Either side may ask to leave, wholly or in part. The request is binding. The exit price is the ${d.window}-second average that starts after the request, never the price at the moment of asking. The leaving side pays a ${fee}% fee on the amount divided to the other side. If the price cannot be measured, nothing is divided and the pot continues; after a failed attempt there is a two-minute pause.`],
    ["When leaving is closed", `No exit can start in the last ${Math.round(lockout / 60)} minutes before the close (${close}), while Gemini has halted the market or put it under review, or while another exit is being priced.`],
    ["Nine lives", "A life is an exit of one ninth of the starting pot. Lives are partial exits like any other and follow the same rules."],
    ["Net and bowl", "Each side may set a net (a low price for its own side) and a bowl (a high one). When the samplers see its own average hold there for a full window, they file the side's exit; it is then priced forward like any other exit. A transferred side loses its net and bowl."],
    ["Handshake", "Both sides may agree to divide at a price they both sign. There is no fee and no measurement; it happens at once."],
    ["Takeover", "During a full exit, someone else may put in the whole pot to take the leaving side's place. The leaving side is paid its share at the exit price from the newcomer, who holds the side from then on and gets the rest of its deposit back. If the exit price cannot be measured, the newcomer gets everything back."],
    ["Settlement", `Without an exit, Gemini's result decides: the whole pot goes to YES if the contract settles YES, to NO if it settles NO. If Gemini voids the contract, both deposits go back.`],
    ["Deadline", `If no result is attested by ${deadline}, anyone can close the pot and both deposits go back.`],
    ["Payments", "Every payment is sent by the pot contract itself. If a payment cannot be delivered, the amount stays claimable by its owner in the contract."],
    ["Sides are tokens", "Each side is a token that can be passed on. Whoever holds it holds the side. It cannot be moved while its exit is being priced."],
    ["Risks", "Gemini's prices can be wrong, thin or slow; the samplers or the relay can be down, which only delays things. This is a test version: test money only, not financial advice. Play within limits."],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 760 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link href={`/pots/${id}`} style={{ fontSize: 15 }}>
          Back to pot {id}
        </Link>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 56, fontWeight: 600, lineHeight: 0.95 }}>Terms of pot {id}</h1>
      </header>
      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 18 }}>
        {terms.map(([k, v]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: `1px solid ${C.faint}`, paddingTop: 12 }}>
            <dt style={{ fontWeight: 600, fontSize: 17 }}>{k}</dt>
            <dd style={{ ...li, margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
