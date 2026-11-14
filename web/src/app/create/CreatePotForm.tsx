"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { encodeFunctionData, erc20Abi, isAddress, parseEventLogs, type Address, type Hex } from "viem";
import { verdictVaultAbi } from "@verdict/relay/abi";
import { getHealth, getJson, type Health } from "@/lib/api";
import { publicClient, USDC_ADDRESS } from "@/lib/chain";
import { formatUsdc, parseUsdc } from "@/lib/format";
import { gaslessCreate } from "@/lib/gasless";
import { useWallet } from "@/lib/wallet/context";
import { useNow } from "@/lib/useNow";
import { buttonCls, Card, Field, inputCls, secondaryButtonCls, Tx } from "@/components/ui";

type Row = { address: string; percent: string };
type Step = { label: string; state: "pending" | "active" | "done" | "error"; tx?: Hex; detail?: string };

function defaultDeadline(nowMs: number) {
  if (!nowMs) return "";
  const d = new Date(nowMs + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function CreatePotForm() {
  const router = useRouter();
  const { account, connect, adapter } = useWallet();
  const [health, setHealth] = useState<Health | null>(null);
  const [label, setLabel] = useState("");
  const now = useNow();
  const [source, setSource] = useState<"manual" | "gemini">("manual");
  const [conditionKey, setConditionKey] = useState("");
  const [rows, setRows] = useState<Row[]>([{ address: "", percent: "100" }]);
  const [refundToInput, setRefundTo] = useState<string | null>(null);
  const [deadlineInput, setDeadline] = useState<string | null>(null);
  // Defaults derive from the wallet and clock until the user edits the field.
  const refundTo = refundToInput ?? account ?? "";
  const deadline = deadlineInput ?? defaultDeadline(now);
  const [amount, setAmount] = useState("1.00");
  // "gasless": the user signs an EIP-3009 authorization and the relay submits (pays gas in USDC).
  const [method, setMethod] = useState<"gasless" | "wallet">("gasless");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e) => setError(`Relay unavailable: ${e.message}`));
  }, []);

  const bps = useMemo(() => rows.map((r) => Math.round(Number(r.percent || 0) * 100)), [rows]);
  const totalBps = bps.reduce((a, b) => a + b, 0);

  const validation = useMemo(() => {
    if (!health?.resolver) return "The relay has no resolver configured.";
    if (!label.trim()) return "Describe the condition.";
    if (rows.some((r) => !isAddress(r.address))) return "Every payee needs a valid address.";
    if (bps.some((b) => b <= 0)) return "Every share must be greater than zero.";
    if (totalBps !== 10_000) return `Shares add up to ${(totalBps / 100).toFixed(2)}%, not 100%.`;
    if (!isAddress(refundTo)) return "Refund address is invalid.";
    if (!deadline || new Date(deadline).getTime() <= now + 60_000) return "Deadline must be in the future.";
    let value: bigint;
    try {
      value = parseUsdc(amount);
    } catch {
      return "Amount is not a valid number.";
    }
    const min = BigInt(health.gasless?.minAmount ?? "0");
    if (method === "gasless" && value < min) return `Gasless funding needs at least ${formatUsdc(min)} USDC.`;
    return null;
  }, [health, label, rows, bps, totalBps, refundTo, deadline, amount, now, method]);

  const setStep = (i: number, patch: Partial<Step>) =>
    setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));

  async function sendAndWait(i: number, to: Address, data: Hex) {
    setStep(i, { state: "active", detail: "Confirm in your wallet" });
    const hash = await adapter.send({ to, data });
    setStep(i, { tx: hash, detail: "Waiting for confirmation" });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted");
    setStep(i, { state: "done", detail: undefined });
    return receipt;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (validation || !health) return;
    setBusy(true);
    setError(null);
    const value = parseUsdc(amount);
    if (method === "gasless") return submitGasless(value);
    const plan: Step[] = [
      { label: "Register condition with relay", state: "pending" },
      { label: "Approve USDC", state: "pending" },
      { label: "Create pot", state: "pending" },
      { label: `Fund pot`, state: "pending" },
    ];
    setSteps(plan);
    let current = 0;
    try {
      const from = account ?? (await connect());
      if (!from) throw new Error("Wallet not connected");

      setStep(0, { state: "active" });
      const condition = await registerCondition();
      setStep(0, { state: "done" });

      current = 1;
      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [from, health.vault],
      });
      if (value > 0n && allowance < value) {
        await sendAndWait(1, USDC_ADDRESS, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [health.vault, value] }));
      } else {
        setStep(1, { state: "done", detail: "Already approved" });
      }

      current = 2;
      const receipt = await sendAndWait(
        2,
        health.vault,
        encodeFunctionData({
          abi: verdictVaultAbi,
          functionName: "createPot",
          args: [
            condition.conditionId,
            health.resolver!,
            rows.map((r) => r.address as Address),
            bps,
            refundTo as Address,
            BigInt(Math.floor(new Date(deadline).getTime() / 1000)),
          ],
        }),
      );
      const created = parseEventLogs({ abi: verdictVaultAbi, logs: receipt.logs, eventName: "PotCreated" })[0];
      if (!created) throw new Error("PotCreated event not found");
      const potId = created.args.potId;

      current = 3;
      if (value > 0n) {
        await sendAndWait(3, health.vault, encodeFunctionData({ abi: verdictVaultAbi, functionName: "fund", args: [potId, value] }));
      } else {
        setStep(3, { state: "done", detail: "Skipped (no amount)" });
      }
      router.push(`/pots/${potId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0]! : String(err);
      setStep(current, { state: "error", detail: msg });
      setError(msg);
      setBusy(false);
    }
  }

  function registerCondition() {
    return getJson<{ conditionId: Hex }>("/api/conditions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source,
        key: conditionKey.trim() || (source === "gemini" ? "" : `pot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
        label: label.trim(),
      }),
    });
  }

  /** Register → sign one authorization → relay creates and funds the pot in one transaction. */
  async function submitGasless(value: bigint) {
    setSteps([
      { label: "Register condition with relay", state: "pending" },
      { label: "Sign USDC authorization (no gas)", state: "pending" },
      { label: "Relay creates and funds the pot", state: "pending" },
    ]);
    let current = 0;
    try {
      const from = account ?? (await connect());
      if (!from) throw new Error("Wallet not connected");
      setStep(0, { state: "active" });
      const condition = await registerCondition();
      setStep(0, { state: "done" });

      current = 1;
      setStep(1, { state: "active", detail: "Confirm the signature in your wallet" });
      const res = await gaslessCreate(
        adapter,
        from,
        {
          conditionId: condition.conditionId,
          resolver: health!.resolver!,
          payees: rows.map((r) => r.address as Address),
          sharesBps: bps,
          refundTo: refundTo as Address,
          deadline: BigInt(Math.floor(new Date(deadline).getTime() / 1000)),
        },
        value,
        () => {
          setStep(1, { state: "done", detail: undefined });
          current = 2;
          setStep(2, { state: "active", detail: "Relay is submitting" });
        },
      );
      setStep(2, { state: "done", tx: res.tx, detail: undefined });
      if (!res.potId) throw new Error("Relay did not return a pot id");
      router.push(`/pots/${res.potId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0]! : String(err);
      setStep(current, { state: "error", detail: msg });
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <Card title="Condition">
          <div className="space-y-4">
            <Field label="Description" hint="What has to happen for the payees to be paid.">
              <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Delivery confirmed by 30 Nov" />
            </Field>
            <Field
              label="Result source"
              hint={
                source === "gemini"
                  ? "Gemini prediction market: met if the contract settles Yes, not met if it settles No."
                  : "Manual: the outcome is reported by an operator through the relay."
              }
            >
              <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as "manual" | "gemini")}>
                <option value="manual">Manual</option>
                <option value="gemini">Gemini prediction market</option>
              </select>
            </Field>
            <Field
              label={source === "gemini" ? "Market" : "Condition key"}
              hint={source === "gemini" ? "Event ticker and contract ticker, e.g. SOL05M2611141625:UP." : "Unique reference within the source. Generated if left empty."}
            >
              <input
                className={`${inputCls} font-mono`}
                value={conditionKey}
                placeholder={source === "gemini" ? "EVENTTICKER:CONTRACT" : "auto"}
                required={source === "gemini"}
                onChange={(e) => setConditionKey(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Payees (if the condition is met)"
          right={<span className={`text-xs ${totalBps === 10_000 ? "text-muted" : "text-negative"}`}>{(totalBps / 100).toFixed(2)}% of 100%</span>}
        >
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={`${inputCls} font-mono`}
                  placeholder="0x…"
                  value={r.address}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, address: e.target.value.trim() } : x)))}
                />
                <div className="relative w-28 shrink-0">
                  <input
                    className={`${inputCls} pr-7 text-right`}
                    inputMode="decimal"
                    value={r.percent}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                  />
                  <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted">%</span>
                </div>
                <button
                  type="button"
                  className={secondaryButtonCls}
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  aria-label="Remove payee"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-sm text-accent disabled:opacity-50"
              disabled={rows.length >= 20}
              onClick={() => setRows([...rows, { address: "", percent: "" }])}
            >
              + Add payee
            </button>
          </div>
        </Card>

        <Card title="Terms">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Refund to (if not met or expired)">
              <input className={`${inputCls} font-mono`} value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} placeholder="0x…" />
            </Field>
            <Field label="Deadline" hint="Funding closes at the deadline. Unresolved pots can be refunded after the grace period.">
              <input type="datetime-local" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
            <Field
              label="Payment method"
              hint={
                method === "gasless"
                  ? "You sign one USDC authorization (EIP-3009); the relay submits it and pays gas. No approve, no gas needed."
                  : "Your wallet sends approve, create and fund transactions and pays gas in USDC."
              }
            >
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as "gasless" | "wallet")}>
                <option value="gasless">Sign only (relay pays gas)</option>
                <option value="wallet">Send transactions from my wallet</option>
              </select>
            </Field>
            <Field label="Initial funding (USDC)" hint="Others can add funds until the deadline.">
              <input className={`${inputCls} text-right`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Resolver" hint="Address whose signature decides the outcome (the relay).">
              <input className={`${inputCls} font-mono text-muted`} readOnly value={health?.resolver ?? "…"} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Review">
          <div className="space-y-4">
            <button type="submit" className={`${buttonCls} w-full`} disabled={busy || Boolean(validation)}>
              {account ? "Create and fund pot" : "Connect wallet and create"}
            </button>
            {validation && <p className="text-sm text-muted">{validation}</p>}
            {error && <p className="text-sm text-negative">{error}</p>}
            {steps.length > 0 && (
              <ol className="space-y-2 text-sm">
                {steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        s.state === "done" ? "bg-positive" : s.state === "active" ? "bg-accent animate-pulse" : s.state === "error" ? "bg-negative" : "bg-border"
                      }`}
                    />
                    <span className="flex-1">
                      {s.label}
                      {s.detail && <span className="block text-xs text-muted">{s.detail}</span>}
                      {s.tx && <Tx hash={s.tx} />}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      </div>
    </form>
  );
}
