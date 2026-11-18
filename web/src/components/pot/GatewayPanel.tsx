"use client";

import { plainError } from "@/lib/messages";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { C, F } from "@/components/cat/tokens";
import { txUrl } from "@/lib/chain";
import { GATEWAY_CHAINS, gatewayBalances, gatewayDeposit, gatewayMove, type GatewayBalance } from "@/lib/gateway";
import { useWallet } from "@/lib/wallet/context";
import { type ActorState } from "./Who";

import { Button } from "@/components/ui/Button";
const input: React.CSSProperties = { minHeight: 44, padding: "0 10px", border: `1.5px solid ${C.ink}`, background: C.page, fontFamily: F.sans, fontSize: 17, color: C.ink, boxSizing: "border-box" };
const usd = (v: number) => `$${v.toFixed(2)}`;

/**
 * Money from anywhere: Circle's unified balance (Circle Gateway, the flow of the "Arc multichain
 * wallet" sample and of the Unified Balance Kit's deposit / getBalances / spend). A wallet deposits
 * USDC on any supported chain; once that chain has finalised it the deposit is confirmed and joins
 * one unified balance; the player spends it into their HonorCat account on Arc with one signature.
 * Circle attests the burn intent and HonorCat's relay mints it on Arc.
 */
type Pending = { domain: number; name: string; amount: number; tx: string; at: number; before: number; wait: string };
const PENDING_KEY = "honorcat.gateway.pending";
const readPending = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as Pending[];
  } catch {
    return [];
  }
};
const writePending = (list: Pending[]) => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* private mode: pending deposits are not remembered */
  }
};
const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return m < 1 ? "just now" : m === 1 ? "1 minute ago" : `${m} minutes ago`;
};
export function GatewayPanel({ who, bare = false }: { who: ActorState; bare?: boolean }) {
  const wallet = useWallet();
  const depositor = wallet.kind === "evm" ? wallet.account : null;
  const recipient: Address | null = who.actor?.account ?? depositor;
  const [balances, setBalances] = useState<GatewayBalance[] | null>(null);
  const [chainId, setChainId] = useState(GATEWAY_CHAINS[0]!.chain.id);
  const [amount, setAmount] = useState("5");
  const [step, setStep] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Deposits made on this device that their chain has not finalised yet (Unified Balance: "pending").
  const [pending, setPending] = useState<Pending[]>([]);
  useEffect(() => {
    void Promise.resolve().then(() => setPending(readPending()));
  }, []);

  const load = useCallback(async () => {
    if (!depositor) return;
    try {
      const b = await gatewayBalances(depositor);
      setBalances(b);
      // A deposit is confirmed once the confirmed balance on its chain has grown by its amount.
      const left = readPending().filter((p) => Number(b.find((x) => x.domain === p.domain)?.balance ?? 0) < p.before + p.amount - 0.000001 && Date.now() - p.at < 24 * 3600_000);
      writePending(left);
      setPending(left);
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
      {!bare && <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Add USDC from any chain</h2>}
      <ol style={{ margin: 0, paddingLeft: 22, fontSize: 16, lineHeight: 1.5, color: C.body }}>
        <li>Deposit USDC from your wallet on any supported chain.</li>
        <li>Once confirmed, move it here with one signature.</li>
      </ol>

      {!depositor ? (
        <WalletChoice label="Connect your wallet" onPick={async (k) => (wallet.setKind(k), await wallet.connect())} busy={wallet.connecting} />
      ) : (
        <>
          <div style={{ borderTop: `1.5px solid ${C.ink}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <strong style={{ fontSize: 17 }}>Ready to move: {balances === null ? "…" : usd(total)}</strong>
            {held.map((b) => (
              <div key={b.domain} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 16 }}>
                <span style={{ minWidth: 160 }}>{b.name}</span>
                <span>{usd(Number(b.balance))}</span>
                {recipient && (
                  <Button variant="quiet"
                    disabled={!!step}
                    style={{ minHeight: 38, fontSize: 15 }}
                    onClick={() =>
                      run(async () => {
                        // Keep a little for Circle's fee, which comes out of the balance on this chain.
                        const v = BigInt(Math.floor(Number(b.balance) * 1e6)) - 50_000n;
                        if (v <= 0n) throw new Error("Too little to move after Circle's fee.");
                        const r = await gatewayMove(wallet.adapter, { sourceDomain: b.domain, depositor, recipient, value: v }, setStep);
                        setNote(`Moved $${(Number(r.value) / 1e6).toFixed(2)} into your account. Transaction: ${txUrl(r.tx)}`);
                        await load();
                        await who.refresh();
                      })
                    }
                  >
                    Move here
                  </Button>
                )}
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.tx} style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 16, color: C.body }}>
                <span style={{ minWidth: 160 }}>{p.name}</span>
                <span>
                  {usd(p.amount)} on its way (deposited {ago(p.at)}, takes {p.wait})
                </span>
              </div>
            ))}
            {balances !== null && held.length === 0 && pending.length === 0 && <span style={{ fontSize: 15, color: C.muted }}>Nothing to move yet.</span>}
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
              <Button
                disabled={!!step || !(Number(amount) > 0)}
                onClick={() =>
                  run(async () => {
                    const domain = chosen.domain;
                    const before = Number(balances?.find((b) => b.domain === domain)?.balance ?? 0);
                    const tx = await gatewayDeposit(wallet.adapter, chosen, BigInt(Math.round(Number(amount) * 1e6)), setStep);
                    const list = [...readPending(), { domain, name: chosen.name, amount: Number(amount), tx, at: Date.now(), before, wait: chosen.wait }];
                    writePending(list);
                    setPending(list);
                    setNote(`Deposited. It is ready to move in ${chosen.wait}.`);
                    await load();
                  })
                }
              >
                Deposit {amount || "0"} USDC
              </Button>
            </div>
            <span style={{ fontSize: 14, color: C.muted }}>
              Ready to move after {chosen.wait}. Need test USDC?{" "}
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
