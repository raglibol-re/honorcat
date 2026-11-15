"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { encodeFunctionData, erc20Abi } from "viem";
import { verdictVaultAbi } from "@verdict/relay/abi";
import { getHealth, usePolling, type PotDetail } from "@/lib/api";
import { gaslessFund } from "@/lib/gasless";
import { publicClient, USDC_ADDRESS } from "@/lib/chain";
import { formatTime, formatUsdc, kindLabel, parseUsdc } from "@/lib/format";
import { useWallet } from "@/lib/wallet/context";
import { useNow } from "@/lib/useNow";
import { Addr, buttonCls, Card, inputCls, StatusBadge, Tx } from "@/components/ui";

const eventText: Record<string, (a: Record<string, unknown>) => string> = {
  PotCreated: () => "Pot created",
  PotFunded: (a) => `Funded ${formatUsdc(String(a.amount))} USDC`,
  PotResolved: (a) => `Resolved: condition ${a.outcome ? "met" : "not met"}`,
  PotExpired: () => "Expired without a result",
  Payout: (a) => `Paid ${formatUsdc(String(a.amount))} USDC`,
  Refund: (a) => `Refunded ${formatUsdc(String(a.amount))} USDC`,
  PaymentDeferred: (a) => `${formatUsdc(String(a.amount))} USDC held as claimable`,
};

export function PotView() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = usePolling<PotDetail>(`/api/pots/${id}`, 2500);
  const now = useNow();

  if (error && !data) {
    return <p className="text-sm text-muted">{error === "pot not found (not indexed yet?)" ? "Waiting for the relay to index this pot…" : error}</p>;
  }
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const { pot, events, payments, relay, relayCost } = data;
  const total = BigInt(pot.total);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">Pot #{pot.potId}</h1>
            <StatusBadge pot={pot} />
          </div>
          <p className="mt-1 text-sm text-muted">{pot.condition?.label ?? "Unregistered condition"}</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted">Locked amount</div>
          <div className="text-2xl font-semibold tabular-nums">{formatUsdc(pot.total)} USDC</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card title="Payees">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 font-medium">Address</th>
                  <th className="pb-2 text-right font-medium">Share</th>
                  <th className="pb-2 text-right font-medium">If met</th>
                </tr>
              </thead>
              <tbody>
                {pot.payees.map((p, i) => {
                  const isLast = i === pot.payees.length - 1;
                  const before = pot.payees.slice(0, -1).reduce((s, x) => s + (total * BigInt(x.shareBps)) / 10000n, 0n);
                  const amount = isLast ? total - before : (total * BigInt(p.shareBps)) / 10000n;
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="py-2">
                        <Addr a={p.address} />
                      </td>
                      <td className="py-2 text-right tabular-nums">{(p.shareBps / 100).toFixed(2)}%</td>
                      <td className="py-2 text-right tabular-nums">{formatUsdc(amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">
              If the condition is not met or no result arrives in time, the full amount is refunded to <Addr a={pot.refundTo} />.
            </p>
          </Card>

          <Card title="Payments">
            {payments.length === 0 ? (
              <p className="text-sm text-muted">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <span>
                      {kindLabel[p.kind]} to <Addr a={p.recipient} />
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{formatUsdc(p.amount)} USDC</span>
                      <Tx hash={p.txHash} label="tx" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="History">
            <ol className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={`${e.txHash}:${e.logIndex}`} className="flex items-center justify-between gap-4">
                  <span>{eventText[e.name]?.(e.args) ?? e.name}</span>
                  <span className="flex items-center gap-3 text-muted">
                    <span className="text-xs">{formatTime(e.time)}</span>
                    <Tx hash={e.txHash} label="tx" />
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <Row k="Deadline" v={formatTime(pot.deadline)} />
              <Row k="Fundings" v={String(pot.fundingCount)} />
              <Row k="Resolver" v={<Addr a={pot.resolver} />} />
              <Row k="Creator" v={<Addr a={pot.creator} />} />
              <Row k="Source" v={pot.condition ? `${pot.condition.source}:${pot.condition.key}` : "—"} />
              {relay && <Row k="Relay" v={`${relay.action} · ${relay.status}`} />}
              {relay?.last_error && <p className="text-xs text-negative">{relay.last_error}</p>}
            </dl>
          </Card>
          {pot.status === "open" && now > 0 && now / 1000 < pot.deadline && <FundCard potId={pot.potId} />}
          {relayCost && relayCost.txs.length > 0 && (
            <Card title="Relay cost">
              <p className="text-xs text-muted">Gas on Arc is paid in USDC. These are the relay&apos;s transactions for this pot.</p>
              <ul className="mt-3 space-y-2 text-sm">
                {relayCost.txs.map((t) => (
                  <li key={t.txHash} className="flex items-center justify-between gap-3">
                    <span>{relayKind[t.kind] ?? t.kind}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{t.feeUsdc ? formatUsdc(t.feeUsdc) : "…"}</span>
                      <Tx hash={t.txHash} label="tx" />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between border-t border-border pt-2 text-sm font-medium">
                <span>Total</span>
                <span className="tabular-nums">{formatUsdc(relayCost.totalUsdc)} USDC</span>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const relayKind: Record<string, string> = {
  resolve: "Resolve",
  expire: "Expire",
  fund_gasless: "Gasless funding",
  create_gasless: "Gasless create + fund",
};

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="truncate">{v}</dd>
    </div>
  );
}

function FundCard({ potId }: { potId: number }) {
  const { adapter, connect } = useWallet();
  const [amount, setAmount] = useState("1.00");
  const [gasless, setGasless] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function fund() {
    setBusy(true);
    setMsg(null);
    try {
      const from = await connect();
      if (!from) throw new Error("Wallet not connected");
      if (gasless) {
        setMsg("Sign the USDC authorization in your wallet…");
        const res = await gaslessFund(adapter, from, potId, parseUsdc(amount), () => setMsg("Relay is submitting…"));
        setMsg(`Funded without gas (tx ${res.tx.slice(0, 10)}…). The amount updates in a moment.`);
        return;
      }
      const { vault } = await getHealth();
      const value = parseUsdc(amount);
      const allowance = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [from, vault] });
      if (allowance < value) {
        setMsg("Approve USDC in your wallet…");
        const h = await adapter.send({ to: USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, value] }) });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      setMsg("Confirm funding in your wallet…");
      const h = await adapter.send({ to: vault, data: encodeFunctionData({ abi: verdictVaultAbi, functionName: "fund", args: [BigInt(potId), value] }) });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setMsg("Funded. The amount updates once the relay indexes it.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message.split("\n")[0]! : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add funds">
      <div className="space-y-3">
        <input className={`${inputCls} text-right`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={gasless} onChange={(e) => setGasless(e.target.checked)} />
          Sign only, relay pays gas (EIP-3009)
        </label>
        <button className={`${buttonCls} w-full`} disabled={busy} onClick={fund}>
          Fund pot
        </button>
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </div>
    </Card>
  );
}
