"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { erc20Abi, isAddress, type Address, type Hex, type TypedDataDefinition } from "viem";
import { GuaranteeCard } from "@/components/guarantee/GuaranteeCard";
import { UnderTheHood } from "@/components/guarantee/UnderTheHood";
import { VerdictMoment } from "@/components/guarantee/VerdictMoment";
import { getJson } from "@/lib/api";
import { publicClient, txUrl, USDC_ADDRESS } from "@/lib/chain";
import { formatUsdc } from "@/lib/format";
import { cardState, toCard, type GuaranteeDetail } from "@/lib/guarantees";
import { useNow } from "@/lib/useNow";
import { deviceWallet } from "@/lib/wallet/device";

const post = <T,>(path: string, body: unknown) =>
  getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Polls the guarantee; notices the moment it settles while the page is open. */
function useGuarantee(id: string) {
  const [d, setD] = useState<GuaranteeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSettled, setJustSettled] = useState(false);
  useEffect(() => {
    let stop = false;
    let prev: GuaranteeDetail | null = null;
    let t: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.visibilityState === "visible") {
        try {
          const next = await getJson<GuaranteeDetail>(`/api/guarantees/${id}`);
          if (prev && cardState(prev) === "active" && cardState(next) !== "active") setJustSettled(true);
          prev = next;
          setD(next);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      if (!stop) t = setTimeout(run, 3000);
    };
    run();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [id]);
  return { d, error, justSettled };
}

function useDeviceAccount() {
  const [account, setAccount] = useState<Address | null>(null);
  useEffect(() => {
    deviceWallet()
      .getAccount()
      .then((a) => setAccount(a));
  }, []);
  return [account, setAccount] as const;
}

export function CustomerView() {
  const { id } = useParams<{ id: string }>();
  const { d, error, justSettled } = useGuarantee(id);
  const [account, setAccount] = useDeviceAccount();
  const now = useNow();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  if (error && !d) return <p className="t-15" style={{ color: "var(--negative)" }}>{error === "guarantee not found" ? "This guarantee does not exist." : error}</p>;
  if (!d) return <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading your guarantee…</p>;

  const g = d.guarantee;
  const me = account ? d.customers.find((c) => c.account.toLowerCase() === account.toLowerCase()) : null;
  const state = cardState(d);
  const open = state === "active" && now > 0 && now / 1000 < g.lockTime;
  const full = d.customers.length >= g.maxCustomers;

  async function join() {
    setJoining(true);
    setJoinError(null);
    try {
      const w = deviceWallet();
      const acct = await w.connect();
      const signature = await w.signMessage(`Join Verdict guarantee ${id} as ${acct}`);
      await post(`/api/guarantees/${id}/join`, { account: acct, signature });
      setAccount(acct);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="mx-auto max-w-[460px] space-y-6">
      {!me && (
        <section className="space-y-4">
          <p className="t-15" style={{ color: "var(--vg-muted)" }}>
            A guarantee from <span style={{ color: "var(--vg-ink)" }}>{g.merchantName}</span>
          </p>
          <h1 className="t-27 font-medium" style={{ textWrap: "pretty" }}>
            {g.promise}
          </h1>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="t-13" style={{ color: "var(--vg-muted)" }}>
                Refund
              </dt>
              <dd className="mono t-21">{formatUsdc(g.refund)} USDC</dd>
            </div>
            <div>
              <dt className="t-13" style={{ color: "var(--vg-muted)" }}>
                Chance of a refund
              </dt>
              <dd className="mono t-21">{d.market?.chanceOfRefund === null || d.market?.chanceOfRefund === undefined ? "—" : `${Math.round(d.market.chanceOfRefund * 100)}%`}</dd>
              <dd className="t-13" style={{ color: "var(--vg-muted)" }}>
                estimate from the market price
              </dd>
            </div>
          </dl>
          {open && !full ? (
            <>
              <button
                type="button"
                disabled={joining}
                onClick={join}
                className="t-17 w-full rounded-xl px-4 py-3.5 font-medium disabled:opacity-60"
                style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}
              >
                {joining ? "Joining…" : "Join with this device"}
              </button>
              <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                No wallet needed. Joining creates an account on this device that receives your refund; HonorCat pays every fee. Passkey
                sign-in replaces this soon. Clearing this browser&apos;s data removes the account, so withdraw a refund once it arrives.
              </p>
              <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                Enrolment closes {new Date(g.lockTime * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}.{" "}
                {g.maxCustomers - d.customers.length} of {g.maxCustomers} places left.
              </p>
            </>
          ) : (
            <p className="t-15 rounded-xl border px-4 py-3" style={{ borderColor: "var(--vg-rule)" }}>
              {state !== "active" ? "This guarantee has settled." : full ? "This guarantee is full." : "Enrolment has closed."}
            </p>
          )}
          {joinError && (
            <p className="t-15" style={{ color: "var(--negative)" }}>
              {joinError}
            </p>
          )}
        </section>
      )}

      {me && (
        <>
          <GuaranteeCard g={toCard(d, account)} />
          {state !== "active" && d.verdict && (
            <VerdictMoment
              play={justSettled}
              resultSeenAt={d.verdict.resultSeenAt}
              resolvedTx={d.verdict.resolvedTx}
              resolvedBlock={d.verdict.resolvedBlock}
              refundTx={me.refund?.tx ?? d.verdict.refundTx}
              refundBlock={me.refund?.block ?? d.verdict.refundBlock}
              resultToPaymentMs={d.verdict.resultToPaymentMs}
              triggered={state === "refunded"}
            />
          )}
          {state === "refunded" && account && <Withdraw account={account} guaranteeId={id} />}
        </>
      )}

      <p className="t-15">
        <Link href={`/g/${id}/proof`} className="underline underline-offset-4">
          See the public proof
        </Link>
      </p>
      <UnderTheHood d={d} account={me ? account : null} />
    </div>
  );
}

function Withdraw({ account, guaranteeId }: { account: Address; guaranteeId: string }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tx?: Hex; error?: boolean } | null>(null);

  useEffect(() => {
    let stop = false;
    const read = () =>
      publicClient
        .readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account] })
        .then((b) => !stop && setBalance(b))
        .catch(() => {});
    read();
    const t = setInterval(read, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [account]);

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(to) || !balance) return;
    setBusy(true);
    setMsg(null);
    try {
      type Prep = { nonce: Hex; validAfter: string; validBefore: string; typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, string> } };
      const p = await post<Prep>("/api/withdraw/prepare", { from: account, to, value: balance.toString() });
      const m = p.typedData.message;
      const signature = await deviceWallet().signTypedData({
        domain: { ...p.typedData.domain, chainId: Number(p.typedData.domain.chainId) },
        types: p.typedData.types,
        primaryType: p.typedData.primaryType,
        message: { ...m, value: BigInt(m.value!), validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) },
      } as unknown as TypedDataDefinition);
      const r = await post<{ tx: Hex }>("/api/withdraw", {
        from: account,
        to,
        value: balance.toString(),
        validAfter: p.validAfter,
        validBefore: p.validBefore,
        nonce: p.nonce,
        signature,
        guaranteeId,
      });
      setMsg({ text: "Sent. No fee was charged to you.", tx: r.tx });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={withdraw} className="vg-ticket space-y-3 px-5 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="t-17 font-medium">Withdraw your refund</h2>
        <span className="mono t-15">{balance === null ? "…" : `${formatUsdc(balance)} USDC`}</span>
      </div>
      <p className="t-13" style={{ color: "var(--vg-muted)" }}>
        Balance read from Arc. Send it to any address; HonorCat pays the fee.
      </p>
      <input
        value={to}
        onChange={(e) => setTo(e.target.value.trim())}
        placeholder="0x… destination address"
        className="mono t-15 w-full rounded-lg border px-3 py-2.5"
        style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}
        aria-label="Destination address"
      />
      <button
        type="submit"
        disabled={busy || !isAddress(to) || !balance}
        className="t-15 w-full rounded-xl px-4 py-3 font-medium disabled:opacity-50"
        style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}
      >
        {busy ? "Sending…" : "Withdraw"}
      </button>
      {msg && (
        <p className="t-13" style={{ color: msg.error ? "var(--negative)" : "var(--vg-muted)" }}>
          {msg.text}{" "}
          {msg.tx && (
            <a className="mono hover:underline" href={txUrl(msg.tx)} target="_blank" rel="noreferrer">
              {msg.tx.slice(0, 10)}…
            </a>
          )}
        </p>
      )}
    </form>
  );
}
