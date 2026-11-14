"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { getJson, usePolling } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { formatUsdc } from "@/lib/format";
import { forgetPasskey, passkeysSupported, savedPasskey, signChallenge, signInWithPasskey, type PasskeySession } from "@/lib/passkey";

type AccountData = {
  account: Address;
  usdc: string;
  deployed: boolean;
  guarantees: { id: string; merchantName: string; promise: string; refund: string; potStatus: string | null; outcome: boolean | null; seat: number }[];
};

const post = <T,>(path: string, body: unknown) =>
  getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const statusText = (g: AccountData["guarantees"][number]) =>
  g.potStatus === "resolved" ? (g.outcome ? "Refunded" : "Not triggered") : g.potStatus === "expired" ? "Closed" : "Waiting for the market";

export function AccountView() {
  const [session, setSession] = useState<PasskeySession | null>(null);
  const [supported, setSupported] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    Promise.resolve().then(() => {
      setSession(savedPasskey());
      setSupported(passkeysSupported());
    });
  }, []);

  async function signIn() {
    setErr(null);
    try {
      setSession(await signInWithPasskey());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (!session) {
    return (
      <section className="vg-ticket space-y-3 px-5 py-5">
        {supported ? (
          <>
            <button
              type="button"
              onClick={signIn}
              className="t-17 w-full rounded-xl px-4 py-3.5 font-medium"
              style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}
            >
              Sign in with passkey
            </button>
            <p className="t-13" style={{ color: "var(--vg-muted)" }}>
              Don&apos;t have one yet? You create it when you join a guarantee.
            </p>
          </>
        ) : (
          <p className="t-15">This browser does not support passkeys.</p>
        )}
        {err && (
          <p className="t-13" style={{ color: "var(--negative)" }}>
            {err}
          </p>
        )}
      </section>
    );
  }
  return (
    <Signed
      session={session}
      onSignOut={() => {
        forgetPasskey();
        setSession(null);
      }}
    />
  );
}

function Signed({ session, onSignOut }: { session: PasskeySession; onSignOut: () => void }) {
  const { data } = usePolling<AccountData>(`/api/accounts/${session.account}`, 5000);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tx?: Hex; error?: boolean } | null>(null);
  const balance = data ? BigInt(data.usdc) : null;

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(to) || !balance) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await post<{ challenge: Hex; deadline: string }>("/api/passkeys/withdraw/prepare", {
        account: session.account,
        to,
        value: balance.toString(),
      });
      const assertion = await signChallenge(session, p.challenge);
      const r = await post<{ tx: Hex }>("/api/passkeys/withdraw", {
        account: session.account,
        to,
        value: balance.toString(),
        deadline: p.deadline,
        assertion,
      });
      setMsg({ text: "Sent. No fee was charged to you.", tx: r.tx });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="vg-ticket px-5 py-5">
        <p className="t-13" style={{ color: "var(--vg-muted)" }}>
          Balance, read from Arc
        </p>
        <p className="mono t-36 mt-1 font-medium">{balance === null ? "…" : formatUsdc(balance)}</p>
        <p className="t-13" style={{ color: "var(--vg-muted)" }}>
          USDC in{" "}
          <a href={addressUrl(session.account)} target="_blank" rel="noreferrer" className="mono hover:underline">
            {session.account.slice(0, 8)}…{session.account.slice(-6)}
          </a>
          {data && !data.deployed ? ", an account that is created on its first withdrawal" : ""}
        </p>
        <form onSubmit={withdraw} className="mt-5 space-y-3">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="0x… destination address"
            aria-label="Destination address"
            className="mono t-15 w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}
          />
          <button
            type="submit"
            disabled={busy || !isAddress(to) || !balance}
            className="t-15 w-full rounded-xl px-4 py-3 font-medium disabled:opacity-50"
            style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}
          >
            {busy ? "Sending…" : "Withdraw everything"}
          </button>
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            You confirm with your passkey; HonorCat pays the fee.
          </p>
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
      </section>

      <section>
        <h2 className="t-17 font-medium">Your guarantees</h2>
        {!data ? (
          <p className="t-15 mt-2" style={{ color: "var(--vg-muted)" }}>
            Loading…
          </p>
        ) : data.guarantees.length === 0 ? (
          <p className="t-15 mt-2" style={{ color: "var(--vg-muted)" }}>
            You have not joined a guarantee with this passkey yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.guarantees.map((g) => (
              <li key={g.id}>
                <Link href={`/g/${g.id}`} className="vg-ticket block px-5 py-4">
                  <div className="t-13 flex justify-between gap-2" style={{ color: "var(--vg-muted)" }}>
                    <span>{g.merchantName}</span>
                    <span>{statusText(g)}</span>
                  </div>
                  <p className="t-15 mt-1">{g.promise}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" onClick={onSignOut} className="t-13 underline underline-offset-4" style={{ color: "var(--vg-muted)" }}>
        Sign out on this device
      </button>
    </div>
  );
}
