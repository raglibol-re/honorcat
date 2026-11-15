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
import {
  createPasskey,
  joinChallenge,
  passkeysSupported,
  savedPasskey,
  signChallenge,
  signInWithPasskey,
  type PasskeySession,
} from "@/lib/passkey";

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

/** The customer's accounts on this browser: a passkey account and/or the device-key fallback. */
function useAccounts() {
  const [passkey, setPasskey] = useState<PasskeySession | null>(null);
  const [device, setDevice] = useState<Address | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => {
    // Browser-only state (local storage, WebAuthn support), read after hydration.
    deviceWallet()
      .getAccount()
      .then((a) => {
        setDevice(a);
        setPasskey(savedPasskey());
        setCanPasskey(passkeysSupported());
      });
  }, []);
  return { passkey, setPasskey, device, setDevice, canPasskey };
}

export function CustomerView() {
  const { id } = useParams<{ id: string }>();
  const { d, error, justSettled } = useGuarantee(id);
  const { passkey, setPasskey, device, setDevice, canPasskey } = useAccounts();
  const now = useNow();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  if (error && !d) return <p className="t-15" style={{ color: "var(--negative)" }}>{error === "guarantee not found" ? "This guarantee does not exist." : error}</p>;
  if (!d) return <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading your guarantee…</p>;

  const g = d.guarantee;
  const isMe = (a?: string | null) => (a ? d.customers.find((c) => c.account.toLowerCase() === a.toLowerCase()) : undefined);
  const me = isMe(passkey?.account) ?? isMe(device) ?? null;
  const account = (me?.account as Address | undefined) ?? null;
  const accountKind: "passkey" | "device" = passkey && me && me.account.toLowerCase() === passkey.account.toLowerCase() ? "passkey" : "device";
  const state = cardState(d);
  const open = state === "active" && now > 0 && now / 1000 < g.lockTime;
  const full = d.customers.length >= g.maxCustomers;

  async function join(kind: "passkey-new" | "passkey-existing" | "device") {
    setJoining(true);
    setJoinError(null);
    try {
      if (kind === "device") {
        const w = deviceWallet();
        const acct = await w.connect();
        const signature = await w.signMessage(`Join Verdict guarantee ${id} as ${acct}`);
        await post(`/api/guarantees/${id}/join`, { account: acct, signature });
        setDevice(acct);
      } else {
        // A passkey account: the address follows from the passkey's public key; it receives the
        // refund before it is deployed. The passkey signs keccak256 of the join message.
        const session = kind === "passkey-existing" ? await signInWithPasskey() : (passkey ?? (await createPasskey()));
        setPasskey(session);
        const assertion = await signChallenge(session, await joinChallenge(`Join Verdict guarantee ${id} as ${session.account}`));
        await post(`/api/guarantees/${id}/join`, { account: session.account, passkey: assertion });
      }
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
              {canPasskey ? (
                <>
                  <button
                    type="button"
                    disabled={joining}
                    onClick={() => join("passkey-new")}
                    className="t-17 w-full rounded-xl px-4 py-3.5 font-medium disabled:opacity-60"
                    style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}
                  >
                    {joining ? "Joining…" : passkey ? "Join with your passkey" : "Join with a passkey"}
                  </button>
                  <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                    No wallet needed. Your passkey (Face ID, Touch ID, Windows Hello or a security key) controls the account that receives
                    your refund; HonorCat pays every fee.
                  </p>
                  <div className="t-13 flex flex-wrap gap-x-4 gap-y-1">
                    {!passkey && (
                      <button type="button" disabled={joining} onClick={() => join("passkey-existing")} className="underline underline-offset-4">
                        I already have a HonorCat passkey
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={joining}
                      onClick={() => join("device")}
                      className="underline underline-offset-4"
                      style={{ color: "var(--vg-muted)" }}
                    >
                      Use a key stored in this browser instead
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={joining}
                    onClick={() => join("device")}
                    className="t-17 w-full rounded-xl px-4 py-3.5 font-medium disabled:opacity-60"
                    style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}
                  >
                    {joining ? "Joining…" : "Join with this browser"}
                  </button>
                  <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                    This browser does not support passkeys, so joining creates an account stored in it; HonorCat pays every fee. Clearing
                    this browser&apos;s data removes the account, so withdraw a refund once it arrives.
                  </p>
                </>
              )}
              <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                Enrolment closes {new Date(g.lockTime * 1000).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.{" "}
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
          {state === "refunded" && account && <Withdraw account={account} kind={accountKind} passkey={passkey} guaranteeId={id} />}
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

function Withdraw({
  account,
  kind,
  passkey,
  guaranteeId,
}: {
  account: Address;
  kind: "passkey" | "device";
  passkey: PasskeySession | null;
  guaranteeId: string;
}) {
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
      if (kind === "passkey" && passkey) {
        // PasskeyAccount.execute(USDC.transfer): the passkey signs, HonorCat deploys the account if
        // needed and submits.
        const p = await post<{ challenge: Hex; deadline: string }>("/api/passkeys/withdraw/prepare", { account, to, value: balance.toString() });
        const assertion = await signChallenge(passkey, p.challenge);
        const r = await post<{ tx: Hex }>("/api/passkeys/withdraw", {
          account,
          to,
          value: balance.toString(),
          deadline: p.deadline,
          assertion,
          guaranteeId,
        });
        setMsg({ text: "Sent. No fee was charged to you.", tx: r.tx });
        return;
      }
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
