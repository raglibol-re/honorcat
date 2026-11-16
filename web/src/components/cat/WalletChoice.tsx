"use client";

import { useEffect, useState } from "react";
import { chooseWallet, useAnnouncedWallets } from "@/lib/wallet/eip6963";
import type { WalletKind } from "@/lib/wallet/context";
import { CatHead } from "./shapes";
import { C, F } from "./tokens";

function solanaFound() {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { phantom?: { solana?: unknown }; solflare?: unknown; solana?: unknown };
  return !!(w.phantom?.solana ?? w.solflare ?? w.solana);
}

const row: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 10px",
  background: "transparent",
  border: 0,
  textAlign: "left",
  fontFamily: F.sans,
  color: C.ink,
};

function Mark({ icon, text }: { icon?: string; text: string }) {
  return icon ? (
    // eslint-disable-next-line @next/next/no-img-element -- a data URI the wallet itself announced (EIP-6963)
    <img src={icon} alt="" width={40} height={40} style={{ flex: "none", width: 40, height: 40, objectFit: "contain" }} />
  ) : (
    <span
      aria-hidden="true"
      style={{ flex: "none", width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", border: `1.5px solid ${C.ink}`, fontFamily: F.cond, fontSize: 18, fontWeight: 700 }}
    >
      {text}
    </span>
  );
}

/**
 * The wallet menu for people who skip the passkey: a quiet text button that opens a ruled list of
 * the wallets this browser has, each by its own name and icon (EIP-6963), plus Solana wallets.
 * Picking one runs `onPick` with that wallet selected for every later request.
 */
export function WalletChoice({ label, onPick, busy }: { label: string; onPick: (k: WalletKind) => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [sol, setSol] = useState(false);
  const evm = useAnnouncedWallets();
  useEffect(() => {
    if (open) void Promise.resolve().then(() => setSol(solanaFound()));
  }, [open]);
  const legacy = typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum && evm.length === 0;

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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}` }}>
            {evm.map((w, i) => (
              <li key={w.info.rdns || w.info.uuid} style={{ borderTop: i ? `1px solid ${C.faint}` : "none" }}>
                <button
                  type="button"
                  className="hc-row"
                  disabled={busy}
                  style={{ ...row, cursor: busy ? "default" : "pointer" }}
                  onClick={() => {
                    chooseWallet(w.info.rdns || w.info.uuid);
                    onPick("evm");
                  }}
                >
                  <Mark icon={w.info.icon} text={w.info.name.slice(0, 2).toUpperCase()} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{w.info.name}</span>
                    <span style={{ fontSize: 14, lineHeight: 1.35, color: C.muted }}>Connects to Arc testnet; you confirm each transaction in {w.info.name}.</span>
                  </span>
                  <CatHead width={18} height={17} />
                </button>
              </li>
            ))}
            {legacy && (
              <li>
                <button type="button" className="hc-row" disabled={busy} style={{ ...row, cursor: busy ? "default" : "pointer" }} onClick={() => onPick("evm")}>
                  <Mark text="EV" />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: 17, fontWeight: 600 }}>Browser wallet</span>
                    <span style={{ fontSize: 14, color: C.muted }}>The wallet extension in this browser.</span>
                  </span>
                </button>
              </li>
            )}
            <li style={{ borderTop: evm.length || legacy ? `1px solid ${C.faint}` : "none" }}>
              <button type="button" className="hc-row" disabled={busy} style={{ ...row, cursor: busy ? "default" : "pointer" }} onClick={() => onPick("solana")}>
                <Mark text="SO" />
                <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>Solana wallet</span>
                  <span style={{ fontSize: 14, lineHeight: 1.35, color: C.muted }}>Phantom or Solflare. Signs once to open your HonorCat account on Arc.</span>
                </span>
                <span style={{ fontSize: 13, color: sol ? C.ink : C.muted }}>{sol ? "found" : "not installed"}</span>
              </button>
            </li>
          </ul>
          {evm.length === 0 && !legacy && (
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>No EVM wallet found in this browser. Install one such as MetaMask or Rabby, or use a passkey: it needs no app.</p>
          )}
        </div>
      )}
    </div>
  );
}
