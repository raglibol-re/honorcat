"use client";

import { plainError } from "@/lib/messages";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { C, F } from "@/components/cat/tokens";
import { txUrl } from "@/lib/chain";
import { GATEWAY_CHAINS, gatewayBalances, gatewayDeposit, gatewayMove, type GatewayBalance } from "@/lib/gateway";
import { useWallet } from "@/lib/wallet/context";
import { btn, btnQuiet, type ActorState } from "./Who";

const input: React.CSSProperties = { minHeight: 44, padding: "0 10px", border: `1.5px solid ${C.ink}`, background: C.page, fontFamily: F.sans, fontSize: 17, color: C.ink, boxSizing: "border-box" };
const usd = (v: number) => `$${v.toFixed(2)}`;

/**
 * Add USDC from another chain with Circle Gateway: a wallet deposits on any supported chain into
 * one unified balance, then moves it to the player's HonorCat account on Arc with one signature.
 * Circle attests the transfer and HonorCat's relay mints it on Arc (no fee to or from Arc).
 */
export function GatewayPanel({ who }: { who: ActorState }) {
  const wallet = useWallet();
  const depositor = wallet.kind === "evm" ? wallet.account : null;
  const recipient: Address | null = who.actor?.account ?? depositor;
  const [balances, setBalances] = useState<GatewayBalance[] | null>(null);
  const [chainId, setChainId] = useState(GATEWAY_CHAINS[0]!.chain.id);
  const [amount, setAmount] = useState("5");
  const [step, setStep] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!depositor) return;
    try {
      setBalances(await gatewayBalances(depositor));
    } catch {
      /* keep the last value */
    }
  }, [depositor]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const run = async (f: () => Promise<void>) => {
    setErr(null);
    setNote(null);
    try {
      await f();
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setStep(null);
    }
  };
  const held = (balances ?? []).filter((b) => Number(b.balance) > 0);
  const total = held.reduce((s, b) => s + Number(b.balance), 0);
  const chosen = GATEWAY_CHAINS.find((c) => c.chain.id === chainId)!;

  return (
    <section id="gateway" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Add USDC from another chain</h2>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: C.body }}>
        With Circle Gateway your USDC on Base, Ethereum, Avalanche, Arbitrum, Optimism or Polygon becomes one balance you can spend on Arc at once. Deposit it once from your
        wallet; after that, moving it into your HonorCat account takes one signature and a few seconds.
      </p>

      {!depositor ? (
        <WalletChoice label="Connect the wallet that holds your USDC" onPick={async (k) => (wallet.setKind(k), await wallet.connect())} busy={wallet.connecting} />
      ) : (
        <>
          <div style={{ borderTop: `1.5px solid ${C.ink}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <strong style={{ fontSize: 17 }}>Your Gateway balance: {balances === null ? "…" : usd(total)}</strong>
            {held.map((b) => (
              <div key={b.domain} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 16 }}>
                <span style={{ minWidth: 160 }}>{b.name}</span>
                <span>{usd(Number(b.balance))}</span>
                {recipient && (
                  <button
                    type="button"
                    disabled={!!step}
                    style={{ ...btnQuiet, minHeight: 38, fontSize: 15 }}
                    onClick={() =>
                      run(async () => {
                        // Keep a little for Circle's fee, which comes out of the balance on this chain.
                        const v = BigInt(Math.floor(Number(b.balance) * 1e6)) - 50_000n;
                        if (v <= 0n) throw new Error("Too little to move after Circle's fee.");
                        const r = await gatewayMove(wallet.adapter, { sourceDomain: b.domain, depositor, recipient, value: v }, setStep);
                        setNote(`Moved $${(Number(r.value) / 1e6).toFixed(2)} into your HonorCat account on Arc. Transaction: ${txUrl(r.tx)}`);
                        await load();
                        await who.refresh();
                      })
                    }
                  >
                    Move into my HonorCat account
                  </button>
                )}
              </div>
            ))}
            {balances !== null && held.length === 0 && <span style={{ fontSize: 15, color: C.muted }}>Nothing deposited yet.</span>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <strong style={{ fontSize: 17 }}>Deposit</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} aria-label="From chain" style={{ ...input, minWidth: 200 }}>
                {GATEWAY_CHAINS.map((c) => (
                  <option key={c.chain.id} value={c.chain.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input style={{ ...input, width: 110 }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="USDC" />
              <button
                type="button"
                style={btn}
                disabled={!!step || !(Number(amount) > 0)}
                onClick={() =>
                  run(async () => {
                    const tx = await gatewayDeposit(wallet.adapter, chosen, BigInt(Math.round(Number(amount) * 1e6)), setStep);
                    setNote(`Deposited on ${chosen.name} (${tx.slice(0, 10)}…). It counts once ${chosen.name} has finalised it: ${chosen.wait}. Then move it into your HonorCat account above.`);
                    await load();
                  })
                }
              >
                Deposit {amount || "0"} USDC
              </button>
            </div>
            <span style={{ fontSize: 14, color: C.muted }}>
              Your wallet pays {chosen.name}&apos;s own network fee for the deposit. It counts after {chosen.wait}. Need test USDC there?{" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                faucet.circle.com
              </a>
              .
            </span>
          </div>
        </>
      )}
      {step && <p style={{ margin: 0 }} aria-live="polite">{step}…</p>}
      {note && <p style={{ margin: 0, color: C.ink }} aria-live="polite">{note}</p>}
      {err && <p role="alert" style={{ margin: 0, color: C.signalInk }}>{err}</p>}
    </section>
  );
}
