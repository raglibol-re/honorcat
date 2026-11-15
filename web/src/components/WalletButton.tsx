"use client";

import { useWallet } from "@/lib/wallet/context";
import { short } from "@/lib/format";

export function WalletButton() {
  const { account, connect, connecting, adapter } = useWallet();
  if (account) {
    return <span className="border border-border px-3 py-1.5 font-mono text-xs">{short(account)}</span>;
  }
  return (
    <button
      onClick={() => connect()}
      disabled={connecting}
      className="border border-border px-3 py-1.5 text-xs font-medium hover:bg-background disabled:opacity-50"
    >
      {connecting ? "Connecting…" : `Connect ${adapter.label.toLowerCase()}`}
    </button>
  );
}
