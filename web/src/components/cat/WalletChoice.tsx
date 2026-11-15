"use client";

import { useEffect, useState } from "react";
import type { WalletKind } from "@/lib/wallet/context";
import { CatHead } from "./shapes";
import { C, F } from "./tokens";

const OPTIONS: { kind: WalletKind; mark: string; name: string; sub: string }[] = [
  { kind: "evm", mark: "EV", name: "Browser wallet", sub: "MetaMask, Rabby, Coinbase Wallet. Works on any EVM chain, no network switch." },
  { kind: "solana", mark: "SO", name: "Solana wallet", sub: "Phantom or Solflare. Signs once to open your HonorCat account on Arc." },
];

function detect(kind: WalletKind) {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { ethereum?: unknown; phantom?: { solana?: unknown }; solflare?: unknown; solana?: unknown };
  return kind === "evm" ? !!w.ethereum : !!(w.phantom?.solana ?? w.solflare ?? w.solana);
}

/**
 * The wallet menu for people who skip the passkey: a quiet text button that opens a ruled list of
 * the two wallet families, each marked found or not installed. Picking one runs `onPick`.
 */
export function WalletChoice({ label, onPick, busy }: { label: string; onPick: (k: WalletKind) => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Record<WalletKind, boolean>>({ evm: false, solana: false });
  useEffect(() => {
    if (open) void Promise.resolve().then(() => setFound({ evm: detect("evm"), solana: detect("solana") }));
  }, [open]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={busy}
        style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: 0, padding: "8px 0", fontFamily: F.sans, fontSize: 16, color: C.ink, cursor: "pointer" }}
      >
        <span style={{ textDecoration: "underline", textUnderlineOffset: 4 }}>{label}</span>
        <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms" }}>
          <path d="M1 1 L6 6 L11 1" fill="none" stroke={C.ink} strokeWidth="1.8" />
        </svg>
      </button>
      {open && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}` }}>
          {OPTIONS.map((o, i) => (
            <li key={o.kind} style={{ borderTop: i ? `1px solid ${C.faint}` : "none" }}>
              <button
                type="button"
                onClick={() => onPick(o.kind)}
                disabled={busy}
                className="hc-row"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 10px", background: "transparent", border: 0, textAlign: "left", fontFamily: F.sans, color: C.ink, cursor: busy ? "default" : "pointer" }}
              >
                <span
                  aria-hidden="true"
                  style={{ flex: "none", width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", border: `1.5px solid ${C.ink}`, fontFamily: F.cond, fontSize: 18, fontWeight: 700 }}
                >
                  {o.mark}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{o.name}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.35, color: C.muted }}>{o.sub}</span>
                </span>
                <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: found[o.kind] ? C.ink : C.muted }}>
                  {found[o.kind] ? "found" : "not installed"}
                  {found[o.kind] ? <CatHead width={18} height={17} /> : <CatHead width={18} height={17} outline />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
