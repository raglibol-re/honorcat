"use client";

import { useId, useState } from "react";
import { C, F } from "@/components/cat/tokens";

type Method = "card" | "bank";

const METHODS: { id: Method; label: string; note: string }[] = [
  { id: "card", label: "Debit card", note: "Also Apple Pay and Google Pay, in the US, the UK, select EU countries and other countries. Credit cards are not accepted." },
  { id: "bank", label: "Bank transfer", note: "In select US states and select EU countries." },
];

const field: React.CSSProperties = { fontFamily: F.sans, fontSize: 17, minHeight: 48, padding: "0 12px", border: `1.5px solid ${C.ink}`, background: C.panel, color: C.ink, boxSizing: "border-box" };

/**
 * Adding money by debit card or bank transfer with Circle's Onramp Kit, as in Circle's "USDC Onramp
 * Demo" sample: shown as a clearly marked demo. Nothing is sent anywhere and no number is made up:
 * Circle's own window shows the price and fees. Why a demo: Onramp needs a Circle API key HonorCat
 * does not have yet, and its sandbox does not deliver to Arc testnet (bank-transfer test deposits land
 * only on Ethereum; a sandbox purchase is never reported as settled).
 */
export function OnrampDemo() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("20");
  const [method, setMethod] = useState<Method>("card");
  const [shown, setShown] = useState(false);
  const ok = /^\d{1,5}(\.\d{0,2})?$/.test(amount.trim()) && Number(amount) > 0;

  return (
    <section aria-labelledby={`${id}-h`} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 id={`${id}-h`} style={{ margin: 0, fontFamily: F.cond, fontSize: 30, fontWeight: 600 }}>
          Add money by card or bank
        </h2>
        <span style={{ fontSize: 14, fontWeight: 700, padding: "2px 8px", border: `1.5px solid ${C.signalInk}`, color: C.signalInk }}>Demo: no money moves</span>
      </div>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: C.body }}>
        With Circle&apos;s Onramp you would buy USDC with a debit card or a bank transfer, and it would land straight in your HonorCat account on Arc. This test version shows the steps only.
      </p>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={{ ...field, background: "transparent", fontWeight: 600, alignSelf: "flex-start", padding: "0 20px", cursor: "pointer" }}>
          Add money (demo)
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, border: `1.5px dashed ${C.ink}` }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 15, color: C.body }}>
            Amount in dollars
            <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/^\$/, "")); setShown(false); }} inputMode="decimal" style={{ ...field, maxWidth: 180 }} />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span id={`${id}-m`} style={{ fontSize: 15, color: C.body }}>
              Pay with
            </span>
            <div role="radiogroup" aria-labelledby={`${id}-m`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {METHODS.map((m) => {
                const on = method === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => { setMethod(m.id); setShown(false); }}
                    style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "8px 12px", textAlign: "left", font: "inherit", color: C.ink, cursor: "pointer", border: `${on ? 2.5 : 1.5}px solid ${on ? C.ink : C.faint}`, background: on ? C.panel : "transparent" }}
                  >
                    <strong style={{ fontSize: 17 }}>{m.label}</strong>
                    <span style={{ fontSize: 14, color: C.muted }}>{m.note}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            disabled={!ok}
            onClick={() => setShown(true)}
            style={{ minHeight: 48, padding: "0 20px", alignSelf: "flex-start", background: C.ink, color: C.page, border: 0, fontFamily: F.sans, fontSize: 17, fontWeight: 600, cursor: "pointer", opacity: ok ? 1 : 0.5 }}
          >
            Continue to Circle&apos;s payment window (demo)
          </button>
          {shown && (
            <div role="status" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 16, lineHeight: 1.5 }}>
              <strong>In the real app, this happens next:</strong>
              <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Circle&apos;s payment window opens here. It shows the price, its fees and how much USDC you get before you pay anything.</li>
                <li>The first time, Circle checks who you are (name, date of birth, address, an ID number and a photo).</li>
                <li>
                  You pay ${Number(amount).toFixed(2)} by {method === "card" ? "debit card" : "bank transfer"}
                  {method === "bank" ? "; a bank transfer can take longer to arrive" : ""}.
                </li>
                <li>The USDC lands in your HonorCat account on Arc, ready for a pot.</li>
              </ol>
              <p style={{ margin: 0, color: C.body }}>
                <strong>Why this is a demo:</strong> Circle&apos;s Onramp needs a Circle API key, which this test version does not have yet. Circle&apos;s test mode also cannot finish a purchase
                on Arc testnet: test bank deposits arrive only on Ethereum, and a test purchase is never reported as settled. Until then, add test money with the{" "}
                <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                  Circle faucet
                </a>{" "}
                or from another chain below.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
