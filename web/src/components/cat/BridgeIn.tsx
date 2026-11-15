"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, http, type Address, type Hex } from "viem";
import { getJson } from "@/lib/api";
import { burnFor, depositForBurnData, fastFeeBps, irisMessage, SOURCES, sourceById, TOKEN_MESSENGER_V2, type SourceChain } from "@/lib/cctp";
import { publicClient, USDC_ADDRESS } from "@/lib/chain";
import { formatMoney } from "@/lib/format";
import { useWallet } from "@/lib/wallet/context";
import { C, F } from "./tokens";

const PENDING = "honorcat.cctp-pending.v1";
type Pending = { domain: number; tx: Hex; account: Address; need: string };

const readPending = (): Pending | null => {
  try {
    return JSON.parse(window.localStorage.getItem(PENDING) ?? "null") as Pending | null;
  } catch {
    return null;
  }
};
const writePending = (p: Pending | null) => {
  try {
    if (p) window.localStorage.setItem(PENDING, JSON.stringify(p));
    else window.localStorage.removeItem(PENDING);
  } catch {
    /* storage blocked: the transfer still completes, only a reload loses track of it */
  }
};

export async function arcUsdc(account: Address): Promise<bigint> {
  return publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account] });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "Pay from": lets a wallet holder fund from USDC on another testnet. Their wallet burns the USDC
 * there with Circle CCTP V2 (Fast Transfer), Circle attests the burn, the relay submits the
 * attestation on Arc and the same address receives the USDC on Arc, ready for the normal one-
 * signature funding. Calls `onReady` once the Arc balance covers `need` (base units, 6 decimals).
 */
export function BridgeIn({ need, onReady }: { need: bigint; onReady: (ready: boolean) => void }) {
  const { adapter, account, connect } = useWallet();
  const [source, setSource] = useState<SourceChain | null>(null);
  const [arc, setArc] = useState<bigint | null>(null);
  const [there, setThere] = useState<bigint | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!account) return;
    const a = await arcUsdc(account).catch(() => null);
    setArc(a);
    onReady(a !== null && a >= need);
    if (source) {
      const c = createPublicClient({ chain: source.chain, transport: http() });
      setThere(await c.readContract({ address: source.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] }).catch(() => null));
    } else setThere(null);
  }, [account, source, need, onReady]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  // Start on the chain the wallet is already on, if it is one we can bring USDC from.
  useEffect(() => {
    void adapter.chainId?.().then((id) => setSource((s) => s ?? sourceById(id))).catch(() => {});
  }, [adapter, account]);

  // A transfer started before a reload: pick it up again.
  useEffect(() => {
    const p = typeof window === "undefined" ? null : readPending();
    if (p && account && p.account.toLowerCase() === account.toLowerCase()) void finish(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  async function finish(p: Pending) {
    setErr(null);
    try {
      setStep("Circle is confirming the transfer…");
      let m = null;
      for (let i = 0; i < 600 && !m; i++) {
        m = await irisMessage(p.domain, p.tx).catch(() => null);
        if (!m) await wait(3000);
      }
      if (!m) throw new Error("Circle has not confirmed the transfer yet. Reload this page later; it picks up where it left off.");
      setStep("Arriving on Arc…");
      await getJson("/api/cctp/receive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: m.message, attestation: m.attestation }) });
      for (let i = 0; i < 20; i++) {
        const a = await arcUsdc(p.account).catch(() => null);
        if (a !== null && a >= BigInt(p.need)) break;
        await wait(1500);
      }
      writePending(null);
      setStep(null);
      await refresh();
    } catch (e) {
      setStep(null);
      setErr(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
  }

  async function bring() {
    if (!source || !adapter.sendOn) return;
    setErr(null);
    try {
      const me = account ?? (await connect());
      if (!me) throw new Error("Wallet not connected");
      const have = (await arcUsdc(me).catch(() => 0n)) ?? 0n;
      const missing = need > have ? need - have : 0n;
      if (missing === 0n) return void (await refresh());
      setStep("Checking the fee…");
      const { amount, maxFee } = burnFor(missing, await fastFeeBps(source.domain));
      const c = createPublicClient({ chain: source.chain, transport: http() });
      const allowance = await c.readContract({ address: source.usdc, abi: erc20Abi, functionName: "allowance", args: [me, TOKEN_MESSENGER_V2] });
      if (allowance < amount) {
        setStep(`Allow the transfer in your wallet (${source.short}).`);
        await adapter.sendOn(source.chain, { to: source.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TOKEN_MESSENGER_V2, amount] }) });
      }
      setStep(`Send ${formatMoney(amount)} from ${source.short} in your wallet.`);
      const tx = await adapter.sendOn(source.chain, { to: TOKEN_MESSENGER_V2, data: depositForBurnData(amount, me, source.usdc, maxFee) });
      const p: Pending = { domain: source.domain, tx, account: me, need: need.toString() };
      writePending(p);
      await finish(p);
    } catch (e) {
      setStep(null);
      setErr(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
  }

  const covered = arc !== null && arc >= need;
  const sel: React.CSSProperties = { minHeight: 48, border: `1.5px solid ${C.ink}`, background: C.panel, color: C.ink, fontFamily: F.sans, fontSize: 17, padding: "0 10px" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 15, color: C.muted }}>Pay from</span>
        <select
          value={source ? String(source.chain.id) : "arc"}
          onChange={(e) => setSource(e.target.value === "arc" ? null : sourceById(Number(e.target.value)))}
          disabled={step !== null}
          style={sel}
        >
          <option value="arc">Arc testnet</option>
          {SOURCES.map((s) => (
            <option key={s.chain.id} value={s.chain.id}>
              {s.short} (moved with Circle CCTP)
            </option>
          ))}
        </select>
      </label>
      {account && (
        <span style={{ fontSize: 14, color: C.muted }}>
          On Arc: {arc === null ? "…" : formatMoney(arc)}
          {source && `. On ${source.short}: ${there === null ? "…" : formatMoney(there)}`}
        </span>
      )}
      {source && !covered && (
        <button
          type="button"
          onClick={bring}
          disabled={step !== null}
          style={{ minHeight: 52, background: "transparent", color: C.ink, border: `1.5px solid ${C.ink}`, fontFamily: F.sans, fontSize: 18, fontWeight: 600, cursor: step ? "default" : "pointer", opacity: step ? 0.6 : 1 }}
        >
          {account ? `Bring ${formatMoney(need - (arc ?? 0n) > 0n ? need - (arc ?? 0n) : need)} from ${source.short}` : "Connect wallet"}
        </button>
      )}
      {source && !covered && !step && (
        <span style={{ fontSize: 14, color: C.muted }}>
          Your wallet signs twice on {source.short} (allow, then send) and pays its gas there. Circle moves the USDC to the same address on Arc in about a minute; the
          fee is about 0.01%.
        </span>
      )}
      {step && <span style={{ fontSize: 15, fontWeight: 600 }}>{step}</span>}
      {err && <span style={{ fontSize: 14, color: C.signalInk }}>{err}</span>}
    </div>
  );
}
