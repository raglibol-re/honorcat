"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, http, type Address } from "viem";
import { getJson } from "@/lib/api";
import { burnFor, depositForBurnData, fastFeeBps, irisMessage, SOLANA_DOMAIN, SOURCES, sourceById, TOKEN_MESSENGER_V2, type SourceChain } from "@/lib/cctp";
import { publicClient, USDC_ADDRESS } from "@/lib/chain";
import { formatMoney } from "@/lib/format";
import { useWallet } from "@/lib/wallet/context";
import { CatHead } from "./shapes";
import { C, F } from "./tokens";

/* ------------------------------------------------------------------ options */

type Option =
  | { id: "arc"; kind: "arc"; name: string; sub: string; mark: string }
  | { id: string; kind: "evm"; name: string; sub: string; mark: string; source: SourceChain }
  | { id: "solana"; kind: "solana"; name: string; sub: string; mark: string };

const MARKS: Record<string, string> = { "Base Sepolia": "BA", "Ethereum Sepolia": "ET", "Arbitrum Sepolia": "AR", "OP Sepolia": "OP", "Avalanche Fuji": "AV", "Polygon Amoy": "PO" };
const ARC: Option = { id: "arc", kind: "arc", name: "Arc testnet", sub: "USDC already on Arc. No fee, nothing to move.", mark: "AC" };
const SOL: Option = { id: "solana", kind: "solana", name: "Solana Devnet", sub: "Phantom or Solflare. Circle moves it in about a minute.", mark: "SO" };
const EVM: Option[] = SOURCES.map((s) => ({ id: String(s.chain.id), kind: "evm", name: s.short, sub: "Any EVM wallet. Circle moves it in about a minute.", mark: MARKS[s.short] ?? "EV", source: s }));
const FEATURED = [ARC, EVM[0]!, EVM[1]!, SOL];
const MORE = EVM.slice(2);

/* ------------------------------------------------------------------ pending transfer (survives reloads) */

const PENDING = "honorcat.cctp-pending.v2";
type Pending = { domain: number; tx: string; account: Address; need: string; from: string };
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
    /* storage blocked: the transfer still completes; only a reload loses track of it */
  }
};

export const arcUsdc = (a: Address) => publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ pieces */

function Mark({ text, on }: { text: string; on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none",
        width: 40,
        height: 40,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        border: `1.5px solid ${on ? C.page : C.ink}`,
        fontFamily: F.cond,
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: "0.02em",
      }}
    >
      {text}
    </span>
  );
}

function Row({ o, on, balance, onPick, disabled }: { o: Option; on: boolean; balance: bigint | null | undefined; onPick: () => void; disabled: boolean }) {
  return (
    <li style={{ borderTop: `1px solid ${C.faint}` }}>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={onPick}
        disabled={disabled}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 12px",
          background: on ? C.ink : "transparent",
          color: on ? C.page : C.ink,
          border: 0,
          textAlign: "left",
          fontFamily: F.sans,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <Mark text={o.mark} on={on} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{o.name}</span>
          <span style={{ fontSize: 14, lineHeight: 1.35, color: on ? C.faint : C.muted }}>{o.sub}</span>
        </span>
        <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 10 }}>
          {balance !== undefined && (
            <span style={{ fontFamily: F.cond, fontSize: 22, fontWeight: 600 }}>{balance === null ? "…" : formatMoney(balance)}</span>
          )}
          {on ? <CatHead width={20} height={19} fill={C.signal} eyes={C.ink} /> : <CatHead width={20} height={19} outline />}
        </span>
      </button>
    </li>
  );
}

type Step = { label: string; state: "done" | "now" | "todo" };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol aria-label="Progress" style={{ display: "flex", margin: 0, padding: 0, listStyle: "none" }}>
      {steps.map((s, i) => (
        <li key={s.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ display: "flex", alignItems: "center", height: 18 }}>
            {s.state === "todo" ? <CatHead width={18} height={17} outline /> : <CatHead width={18} height={17} fill={s.state === "now" ? C.signal : C.ink} />}
            {i < steps.length - 1 &&
              (steps[i + 1]!.state === "todo" ? (
                <span style={{ flex: 1, borderTop: `2px dashed ${C.dash}` }} />
              ) : (
                <span style={{ flex: 1, height: 2, background: C.ink }} />
              ))}
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.25, fontWeight: s.state === "now" ? 600 : 400, color: s.state === "todo" ? C.muted : C.ink, paddingRight: 6 }}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ the panel */

/**
 * "Pay with": where the funder's USDC comes from. Arc pays directly. Another EVM testnet or Solana
 * Devnet: the wallet burns the USDC there with Circle CCTP V2 (Fast Transfer), Circle attests the
 * burn, the relay submits it on Arc and the funder's Arc account receives the USDC, ready for the
 * one-signature funding. Calls `onReady` with whether the Arc balance covers `need`.
 */
export function PayFrom({ need, onReady }: { need: bigint; onReady: (ready: boolean | null) => void }) {
  const { adapter, account, connect, kind, setKind, solana } = useWallet();
  const [pick, setPick] = useState<Option>(ARC);
  const [more, setMore] = useState(false);
  const [arc, setArc] = useState<bigint | null>(null);
  const [balances, setBalances] = useState<Record<string, bigint | null>>({});
  const [phase, setPhase] = useState<number>(-1); // index into the step list while moving money
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const busy = phase >= 0;

  // Arc balance of whichever account is active (EVM wallet, or the Solana wallet's Arc account).
  const refresh = useCallback(async () => {
    if (!account) {
      setArc(null);
      onReady(null);
      return;
    }
    const a = await arcUsdc(account).catch(() => null);
    setArc(a);
    onReady(a === null ? null : a >= need);
    if (kind === "evm") {
      const rows = await Promise.all(
        SOURCES.map(async (s) => {
          const c = createPublicClient({ chain: s.chain, transport: http() });
          const v = await c.readContract({ address: s.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] }).catch(() => null);
          return [String(s.chain.id), v] as const;
        }),
      );
      setBalances(Object.fromEntries(rows));
    } else if (solana.owner) {
      const { solanaUsdc } = await import("@/lib/solana");
      setBalances({ solana: await solanaUsdc(solana.owner).catch(() => null) });
    }
  }, [account, kind, need, onReady, solana]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  // Start on the chain the EVM wallet is on, if it is a source we support.
  useEffect(() => {
    if (kind !== "evm") return;
    void adapter.chainId?.().then((id) => {
      const s = sourceById(id);
      if (s) setPick((p) => (p.id === "arc" ? EVM.find((o) => o.id === String(s.chain.id))! : p));
    });
  }, [adapter, kind, account]);

  // Pick up a transfer that was still on its way when the page was closed.
  useEffect(() => {
    const p = readPending();
    if (p && account && p.account.toLowerCase() === account.toLowerCase()) void land(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  function choose(o: Option) {
    setErr(null);
    setPick(o);
    const want = o.kind === "solana" ? "solana" : "evm";
    if (want !== kind) setKind(want);
  }

  async function land(p: Pending) {
    setErr(null);
    try {
      setPhase(2);
      setNote(`Circle is confirming the transfer from ${p.from}.`);
      let m = null;
      for (let i = 0; i < 600 && !m; i++) {
        m = await irisMessage(p.domain, p.tx).catch(() => null);
        if (!m) await wait(3000);
      }
      if (!m) throw new Error("Circle has not confirmed the transfer yet. Come back later: this page picks up where it left off.");
      setPhase(3);
      setNote("Arriving on Arc…");
      await getJson("/api/cctp/receive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: m.message, attestation: m.attestation }) });
      for (let i = 0; i < 20; i++) {
        const a = await arcUsdc(p.account).catch(() => null);
        if (a !== null && a >= BigInt(p.need)) break;
        await wait(1500);
      }
      writePending(null);
      setPhase(-1);
      setNote(`Arrived. ${formatMoney(BigInt(p.need))} is on Arc.`);
      await refresh();
    } catch (e) {
      setPhase(-1);
      setNote(null);
      setErr(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
  }

  async function bring() {
    setErr(null);
    setNote(null);
    try {
      setPhase(0);
      if (!account) {
        // Connecting is its own click: show the balances first, move money on the next.
        const a = await connect();
        if (!a) throw new Error("Wallet not connected");
        setPhase(-1);
        return;
      }
      const me = account;
      const have = (await arcUsdc(me).catch(() => 0n)) ?? 0n;
      const missing = need > have ? need - have : 0n;
      if (missing === 0n) {
        setPhase(-1);
        return void (await refresh());
      }
      if (pick.kind === "solana") {
        const { sendBurn, solanaProvider } = await import("@/lib/solana");
        const provider = solanaProvider();
        if (!provider || !solana.owner) throw new Error("No Solana wallet found. Install Phantom or Solflare.");
        const { amount, maxFee } = burnFor(missing, await fastFeeBps(SOLANA_DOMAIN));
        const { solanaUsdc } = await import("@/lib/solana");
        if ((await solanaUsdc(solana.owner)) < amount) throw new Error(`Not enough USDC on Solana Devnet (${formatMoney(amount)} needed). Get test USDC at faucet.circle.com.`);
        setPhase(1);
        setNote(`Approve sending ${formatMoney(amount)} from Solana Devnet in your wallet.`);
        const tx = await sendBurn(provider, solana.owner, amount, maxFee, me);
        const p: Pending = { domain: SOLANA_DOMAIN, tx, account: me, need: need.toString(), from: "Solana Devnet" };
        writePending(p);
        return void (await land(p));
      }
      if (pick.kind !== "evm" || !adapter.sendOn) return setPhase(-1);
      const s = pick.source;
      const { amount, maxFee } = burnFor(missing, await fastFeeBps(s.domain));
      const c = createPublicClient({ chain: s.chain, transport: http() });
      const held = await c.readContract({ address: s.usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      if (held < amount) throw new Error(`Not enough USDC on ${s.short} (${formatMoney(amount)} needed). Get test USDC at faucet.circle.com.`);
      const allowance = await c.readContract({ address: s.usdc, abi: erc20Abi, functionName: "allowance", args: [me, TOKEN_MESSENGER_V2] });
      if (allowance < amount) {
        setNote(`Allow ${formatMoney(amount)} on ${s.short} in your wallet.`);
        await adapter.sendOn(s.chain, { to: s.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TOKEN_MESSENGER_V2, amount] }) });
      }
      setPhase(1);
      setNote(`Send ${formatMoney(amount)} from ${s.short} in your wallet.`);
      const tx = await adapter.sendOn(s.chain, { to: TOKEN_MESSENGER_V2, data: depositForBurnData(amount, me, s.usdc, maxFee) });
      const p: Pending = { domain: s.domain, tx, account: me, need: need.toString(), from: s.short };
      writePending(p);
      await land(p);
    } catch (e) {
      setPhase(-1);
      setNote(null);
      setErr(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
  }

  const covered = arc !== null && arc >= need;
  const missing = arc === null ? need : need > arc ? need - arc : 0n;
  const cross = pick.kind !== "arc";
  const labels = pick.kind === "solana" ? ["Sign in", "Send on Solana", "Circle confirms", "On Arc"] : ["Allow", `Send on ${pick.name.split(" ")[0]}`, "Circle confirms", "On Arc"];
  const steps: Step[] = labels.map((label, i) => ({ label, state: covered && !busy ? "done" : i < phase ? "done" : i === phase ? "now" : "todo" }));
  const rows = more ? [...FEATURED, ...MORE] : FEATURED;
  const bal = (o: Option): bigint | null | undefined => {
    if (!account) return undefined;
    if (o.kind === "arc") return kind === "evm" ? arc : undefined;
    if (o.kind === "solana") return kind === "solana" ? (balances.solana ?? null) : undefined;
    return kind === "evm" ? (balances[o.id] ?? null) : undefined;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>Pay with</span>
        {account && (
          <span style={{ fontSize: 14, color: C.muted }}>
            {kind === "solana" ? "Your Solana wallet’s Arc account: " : "On Arc: "}
            {arc === null ? "…" : formatMoney(arc)}
          </span>
        )}
      </div>
      <ul role="radiogroup" aria-label="Pay with" style={{ margin: 0, padding: 0, listStyle: "none", borderBottom: `1.5px solid ${C.ink}`, borderTop: `1.5px solid ${C.ink}` }}>
        {rows.map((o) => (
          <Row key={o.id} o={o} on={pick.id === o.id} balance={bal(o)} onPick={() => choose(o)} disabled={busy} />
        ))}
        <li style={{ borderTop: `1px solid ${C.faint}` }}>
          <button
            type="button"
            onClick={() => setMore(!more)}
            disabled={busy}
            style={{ width: "100%", padding: "10px 12px", background: "transparent", border: 0, textAlign: "left", fontFamily: F.sans, fontSize: 15, color: C.muted, cursor: "pointer" }}
          >
            {more ? "Fewer chains" : `${MORE.length} more chains: ${MORE.map((o) => o.name).join(", ")}`}
          </button>
        </li>
      </ul>

      {cross && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Steps steps={steps} />
          {!covered || busy ? (
            <button
              type="button"
              onClick={bring}
              disabled={busy}
              style={{
                minHeight: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                background: "transparent",
                color: C.ink,
                border: `1.5px solid ${C.ink}`,
                fontFamily: F.sans,
                fontSize: 18,
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {!account
                ? pick.kind === "solana"
                  ? "Connect Solana wallet"
                  : "Connect wallet"
                : busy
                  ? "Moving your USDC…"
                  : `Bring ${formatMoney(missing > 0n ? missing : need)} from ${pick.name}`}
            </button>
          ) : null}
          <span style={{ fontSize: 14, lineHeight: 1.45, color: C.muted }}>
            {note ??
              (pick.kind === "solana"
                ? "Your Solana wallet signs once to open its HonorCat account on Arc, then sends the USDC. It pays a little SOL for the transaction; the transfer fee is about 0.01%."
                : `Your wallet signs on ${pick.name} (allow, then send) and pays its gas there. The USDC arrives at the same address on Arc; the fee is about 0.01%.`)}
          </span>
        </div>
      )}
      {err && <span style={{ fontSize: 14, color: C.signalInk }}>{err}</span>}
    </div>
  );
}
