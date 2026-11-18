"use client";

import { DivisionCard } from "@/components/pot/DivisionCard";
import { divisionReceipts } from "@/lib/divisionReceipt";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { txUrl } from "@/lib/chain";
import { cents, receiptsOf, took, type ReceiptEvent } from "@/lib/receipts";

/** The average network fee of an action kind, as cents (from the relay's receipts). */
export function useFees() {
  const { data } = usePolling<{ fees: Record<string, string> }>("/api/hc/fees", 300_000);
  return data?.fees ?? {};
}

/**
 * The fee of an action in cents, next to its button: "network fee about 0.6¢, paid by HonorCat"
 * for passkey players, "about 0.6¢ from your wallet" for browser wallets.
 */
export function FeeNote({ fees, kind = "pot_exec", payer }: { fees: Record<string, string>; kind?: string; payer: "honorcat" | "wallet" }) {
  const c = cents(fees[kind] ?? fees.pot_exec ?? null);
  if (!c) return null;
  return (
    <span style={{ fontSize: 13, color: C.muted }}>
      Arc network fee about {c}
      {payer === "honorcat" ? ", paid by HonorCat" : ", paid from your wallet in USDC"}.
    </span>
  );
}

/**
 * Every payout of the pot as a receipt sentence ("You left at 74.5% and received $7.40."), how long
 * it took from the request, its network fee in cents, and the transaction whose memo records it.
 */
export function Receipts({
  events,
  fees,
  mySide,
  name,
  says,
  fur,
}: {
  events: ReceiptEvent[];
  fees: Record<string, string>;
  mySide: number | null;
  name: (side: number) => string;
  says: (side: number) => string;
  /** Each side's fur colour (hex), for the exit receipts' bar. */
  fur?: (side: number) => string;
}) {
  // Exits get the full receipt card; handshakes and settlements stay as sentences.
  const divisions = divisionReceipts(events);
  const list = receiptsOf(events, mySide, name, says, { skipDivisions: true });
  if (!list.length && !divisions.length) return null;
  return (
    <section aria-label="Receipts" style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>Receipts</h2>
      {divisions.map((r) => (
        <DivisionCard key={r.tx} r={r} mySide={mySide} name={name} fur={fur ?? ((s) => (s === 0 ? C.ink : C.signal))} fee={fees[r.tx.toLowerCase()]} />
      ))}
      {list.length > 0 && (
      <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
        {list.map((r) => (
          <li key={r.tx} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "10px 0", borderBottom: `1px solid ${C.faint}` }}>
            <strong style={{ fontSize: 19, fontWeight: 600 }}>{r.text}</strong>
            <span style={{ fontSize: 14, color: C.muted }}>
              {r.tookS !== null && r.tookS > 0 ? `Paid out ${took(0, r.tookS)} after the request. ` : ""}
              {cents(fees[r.tx.toLowerCase()]) ? `Arc network fee ${cents(fees[r.tx.toLowerCase()])}, paid by HonorCat. ` : ""}
              <a href={txUrl(r.tx)} target="_blank" rel="noreferrer">
                The payout on Arc
              </a>
              , with its memo.
            </span>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
