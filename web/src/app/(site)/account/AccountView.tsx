"use client";

import Link from "next/link";
import { TechOnly } from "@/components/TechMode";
import { useEffect, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { usePolling } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { formatUsdc } from "@/lib/format";
import { CatHead, Ears, EyesSmall } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";
import { useWallet } from "@/lib/wallet/context";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { forgetPasskey, passkeysSupported, savedPasskey, signInWithPasskey, type PasskeySession } from "@/lib/passkey";
import { SendTo } from "@/components/pot/SendTo";
import { sendUsdc } from "@/lib/send";
import { plainError } from "@/lib/messages";

type AccountData = {
  account: Address;
  usdc: string;
  deployed: boolean;
  guarantees: { id: string; merchantName: string; promise: string; refund: string; potStatus: string | null; outcome: boolean | null; seat: number }[];
};

const btn: React.CSSProperties = {
  width: "100%",
  minHeight: 52,
  background: C.ink,
  color: C.page,
  border: 0,
  fontFamily: F.sans,
  fontSize: 18,
  fontWeight: 600,
  cursor: "pointer",
};

const statusText = (g: AccountData["guarantees"][number]) =>
  g.potStatus === "resolved" ? (g.outcome ? "Refunded" : "Not triggered") : g.potStatus === "expired" ? "Closed" : "Waiting for the market";

export function AccountView() {
  const [session, setSession] = useState<PasskeySession | null>(null);
  const [supported, setSupported] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const wallet = useWallet();
  const [useWalletView, setUseWalletView] = useState(false);
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

  if (!session && useWalletView && wallet.account)
    return <WalletMoney account={wallet.account} solana={wallet.kind === "solana" ? (wallet.solana.owner?.toBase58() ?? null) : null} />;
  if (!session) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {supported ? (
          <>
            <button type="button" onClick={signIn} style={btn}>
              Sign in with passkey
            </button>
            <p style={{ margin: 0, fontSize: 15, color: C.muted }}>No passkey yet? You get one when you join.</p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 17 }}>This browser does not support passkeys.</p>
        )}
        <WalletChoice
          label="Use a wallet instead"
          onPick={async (k) => {
            setErr(null);
            try {
              const ad = k === "solana" ? wallet.solana : wallet.evm;
              wallet.setKind(k);
              await ad.connect();
              setUseWalletView(true);
            } catch (e) {
              setErr(e instanceof Error ? e.message.split("\n")[0]! : String(e));
            }
          }}
        />
        {err && <p style={{ margin: 0, fontSize: 15, color: C.signalInk }}>{err}</p>}
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
      // The same passkey-signed transfer as sending to a player; HonorCat pays the network fee.
      const tx = await sendUsdc({ kind: "passkey", session, account: session.account }, to as Address, balance);
      setMsg({ text: "Sent.", tx });
    } catch (err) {
      setMsg({ text: plainError(err), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section style={{ display: "flex", flexDirection: "column" }}>
        <Ears viewBox="0 0 342 30" points={["22,31 54,2 86,31", "256,31 288,2 320,31"]} />
        <div style={{ background: C.ink, color: C.page, padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: F.cond, fontSize: 30, fontWeight: 600 }}>Your balance</span>
            <EyesSmall />
          </div>
          <span style={{ fontFamily: F.cond, fontSize: "clamp(72px, 24vw, 132px)", fontWeight: 700, lineHeight: 0.92, letterSpacing: "-0.01em" }}>
            {balance === null ? "…" : `$${formatUsdc(balance)}`}
          </span>
          <span style={{ fontSize: 15, color: C.faint }}>
            test USDC on Arc
            <TechOnly>
              {" in "}
              <a href={addressUrl(session.account)} target="_blank" rel="noreferrer" style={{ fontFamily: F.mono, fontSize: 13, color: C.page }}>
                {session.account.slice(0, 8)}…{session.account.slice(-6)}
              </a>
              {data && !data.deployed ? ", an account that is created on its first withdrawal" : ""}
            </TechOnly>
          </span>
        </div>
      </section>

      <form onSubmit={withdraw} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder="Send to (0x… address)"
          aria-label="Destination address"
          style={{ fontFamily: F.mono, fontSize: 15, minHeight: 52, padding: "0 14px", border: `1.5px solid ${C.ink}`, background: C.panel, color: C.ink, width: "100%", boxSizing: "border-box" }}
        />
        <button type="submit" disabled={busy || !isAddress(to) || !balance} style={{ ...btn, opacity: busy || !isAddress(to) || !balance ? 0.5 : 1 }}>
          {busy ? "Sending…" : "Withdraw everything"}
        </button>
        {msg && (
          <p style={{ margin: 0, fontSize: 15, color: msg.error ? C.signalInk : C.muted }}>
            {msg.text}{" "}
            {msg.tx && (
              <a style={{ fontFamily: F.mono, fontSize: 13 }} href={txUrl(msg.tx)} target="_blank" rel="noreferrer">
                {msg.tx.slice(0, 10)}…
              </a>
            )}
          </p>
        )}
      </form>

      <SendTo actor={{ kind: "passkey", session, account: session.account }} balance={balance} />

      {data && data.guarantees.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>Your guarantees</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}` }}>
            {data.guarantees.map((g, i) => (
              <li key={g.id} style={{ borderTop: i ? `1px solid ${C.faint}` : undefined }}>
                <Link href={`/g/${g.id}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", textDecoration: "none" }}>
                  <CatHead width={18} height={17} style={{ marginTop: 3 }} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 17, fontWeight: 600 }}>{g.merchantName}</span>
                      <span style={{ fontSize: 14, color: C.muted, textAlign: "right" }}>{statusText(g)}</span>
                    </span>
                    <span style={{ fontSize: 15, color: C.body }}>{g.promise}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        onClick={onSignOut}
        style={{ alignSelf: "flex-start", background: "none", border: 0, padding: "12px 0", fontFamily: F.sans, fontSize: 15, color: C.muted, textDecoration: "underline", textUnderlineOffset: 4, cursor: "pointer" }}
      >
        Sign out on this device
      </button>
    </div>
  );
}

/** For people who joined with a wallet: payouts land straight in that wallet's address on Arc. */
function WalletMoney({ account, solana }: { account: Address; solana: string | null }) {
  const { data } = usePolling<AccountData>(`/api/accounts/${account}`, 5000);
  const wallet = useWallet();
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Ears viewBox="0 0 342 30" points={["22,31 54,2 86,31", "256,31 288,2 320,31"]} />
        <div style={{ background: C.ink, color: C.page, padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: F.cond, fontSize: 30, fontWeight: 600 }}>{solana ? "Your Solana wallet’s Arc account" : "Your wallet on Arc"}</span>
            <EyesSmall />
          </div>
          <span style={{ fontFamily: F.cond, fontSize: 96, fontWeight: 700, lineHeight: 0.92 }}>${data ? formatUsdc(data.usdc) : "…"}</span>
          <a href={addressUrl(account)} target="_blank" rel="noreferrer" style={{ fontFamily: F.mono, fontSize: 13, color: C.faint }}>
            {account.slice(0, 8)}…{account.slice(-6)}
          </a>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: C.body }}>
        {solana
          ? `Payouts go to this Arc account. Your Solana wallet (${solana.slice(0, 4)}…${solana.slice(-4)}) controls it: signing the same HonorCat message on any device opens it again.`
          : "Payouts go straight to this address on Arc. Nothing to withdraw: the USDC is already in your wallet, and Circle CCTP can move it to any other supported chain."}
      </p>
      {!solana && <SendTo actor={{ kind: "wallet", adapter: wallet.adapter, account }} balance={data ? BigInt(data.usdc) : null} />}
    </section>
  );
}
