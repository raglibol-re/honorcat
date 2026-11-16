"use client";

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, type Address } from "viem";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { C, F } from "@/components/cat/tokens";
import { publicClient, USDC_ADDRESS, addressUrl } from "@/lib/chain";
import { short } from "@/lib/format";
import type { Actor } from "@/lib/hc";
import { createPasskey, forgetPasskey, passkeysSupported, savedPasskey, signInWithPasskey, type PasskeySession } from "@/lib/passkey";
import { useWallet } from "@/lib/wallet/context";

export const btn: React.CSSProperties = {
  minHeight: 52,
  padding: "0 24px",
  background: C.ink,
  color: C.page,
  border: 0,
  fontFamily: F.sans,
  fontSize: 18,
  fontWeight: 600,
  cursor: "pointer",
};
export const btnQuiet: React.CSSProperties = { ...btn, background: "transparent", color: C.ink, border: `1.5px solid ${C.ink}` };

/** The person acting on this page: a passkey account (default) or a wallet, with its Arc USDC balance. */
export function useActor() {
  const wallet = useWallet();
  const [session, setSession] = useState<PasskeySession | null>(null);
  const [preferWallet, setPreferWallet] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => setSession(savedPasskey()));
  }, []);

  const actor: Actor | null =
    !preferWallet && session
      ? { kind: "passkey", session, account: session.account }
      : wallet.account
        ? { kind: "wallet", adapter: wallet.adapter, account: wallet.account }
        : session
          ? { kind: "passkey", session, account: session.account }
          : null;

  const account = actor?.account ?? null;
  const refresh = useCallback(async () => {
    if (!account) return setBalance(null);
    try {
      setBalance(await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account as Address] }));
    } catch {
      /* keep the last value */
    }
  }, [account]);
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  return {
    actor,
    balance,
    refresh,
    setSession: (s: PasskeySession | null) => {
      setSession(s);
      setPreferWallet(false);
    },
    useWalletInstead: () => setPreferWallet(true),
    signOut: () => {
      forgetPasskey();
      setSession(null);
    },
    wallet,
  };
}

export type ActorState = ReturnType<typeof useActor>;

/** Sign in: a passkey (no app, no seed words) or, for people who have one, a wallet. */
export function SignIn({ who, purpose }: { who: ActorState; purpose: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const supported = typeof window === "undefined" ? true : passkeysSupported();
  const run = async (f: () => Promise<PasskeySession>) => {
    setBusy(true);
    setErr(null);
    try {
      who.setSession(await f());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: C.body }}>{purpose}</p>
      {supported && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <button type="button" style={btn} disabled={busy} onClick={() => run(createPasskey)}>
            Create a passkey
          </button>
          <button type="button" style={btnQuiet} disabled={busy} onClick={() => run(signInWithPasskey)}>
            I have one
          </button>
        </div>
      )}
      <WalletChoice
        label="Use a wallet instead"
        busy={busy || who.wallet.connecting}
        onPick={async (k) => {
          who.wallet.setKind(k);
          who.useWalletInstead();
          await who.wallet.connect();
        }}
      />
      {(err || who.wallet.error) && (
        <p role="alert" style={{ margin: 0, color: C.signalInk, fontSize: 15 }}>
          {err ?? who.wallet.error}
        </p>
      )}
    </div>
  );
}

/** One line: who is acting, how much test USDC they hold, where to get more. */
export function AccountLine({ who }: { who: ActorState }) {
  if (!who.actor) return null;
  const a = who.actor.account;
  return (
    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: C.muted }}>
      {who.actor.kind === "passkey" ? "Your passkey account" : "Your wallet"}{" "}
      <a href={addressUrl(a)} target="_blank" rel="noreferrer" style={{ fontFamily: F.mono, fontSize: 14 }}>
        {short(a)}
      </a>{" "}
      holds <strong style={{ color: C.ink }}>{who.balance === null ? "…" : `${(Number(who.balance) / 1e6).toFixed(2)} USDC`}</strong> (test money).{" "}
      <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
        Get test USDC
      </a>{" "}
      for Arc testnet at this address, or bring it from another chain on the{" "}
      <a href="/account">account page</a>.
      {who.actor.kind === "passkey" && (
        <>
          {" "}
          <button type="button" onClick={who.signOut} style={{ background: "none", border: 0, padding: 0, color: C.muted, textDecoration: "underline", cursor: "pointer", fontSize: 15 }}>
            Sign out
          </button>
        </>
      )}
    </p>
  );
}
