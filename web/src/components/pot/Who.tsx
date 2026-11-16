"use client";

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, type Address } from "viem";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { C, F } from "@/components/cat/tokens";
import { publicClient, USDC_ADDRESS, addressUrl } from "@/lib/chain";
import { getJson } from "@/lib/api";
import { setMyName, useNames } from "@/lib/names";
import { useTechMode } from "@/components/TechMode";
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

/**
 * Who is acting: their name (editable), how much test USDC they hold, a button for test USDC when
 * they have little, and the address only with technical details on.
 */
export function AccountLine({ who }: { who: ActorState }) {
  const { tech } = useTechMode();
  const a = who.actor?.account ?? null;
  const names = useNames([a]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!who.actor || !a) return null;
  const myName = names[a.toLowerCase()];
  const low = who.balance !== null && who.balance < 2_000_000n;
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await f();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: C.muted }}>
        Playing as <strong style={{ color: C.ink }}>{myName ?? (who.actor.kind === "passkey" ? "your passkey account" : "your wallet")}</strong>{" "}
        {!editing && (
          <button type="button" onClick={() => (setEditing(true), setDraft(myName ?? ""))} style={{ background: "none", border: 0, padding: 0, color: C.muted, textDecoration: "underline", cursor: "pointer", fontSize: 15 }}>
            {myName ? "change name" : "set a name"}
          </button>
        )}
        {tech && (
          <>
            {" "}
            ·{" "}
            <a href={addressUrl(a)} target="_blank" rel="noreferrer" style={{ fontFamily: F.mono, fontSize: 14 }}>
              {short(a)}
            </a>
          </>
        )}{" "}
        · holds <strong style={{ color: C.ink }}>{who.balance === null ? "…" : `${(Number(who.balance) / 1e6).toFixed(2)} USDC`}</strong> (test money).
        {who.actor.kind === "passkey" && (
          <>
            {" "}
            <button type="button" onClick={who.signOut} style={{ background: "none", border: 0, padding: 0, color: C.muted, textDecoration: "underline", cursor: "pointer", fontSize: 15 }}>
              Sign out
            </button>
          </>
        )}
      </p>
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await setMyName(who.actor!, draft.trim());
              setEditing(false);
              setNote("Saved. Others see this name instead of your address.");
            });
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={24}
            placeholder="Your name on the rope"
            aria-label="Display name"
            style={{ minHeight: 40, padding: "0 10px", border: `1.5px solid ${C.ink}`, background: C.page, fontFamily: F.sans, fontSize: 16, width: 220 }}
          />
          <button type="submit" disabled={busy || draft.trim().length < 2} style={{ ...btnQuiet, minHeight: 40, fontSize: 16 }}>
            Save (one confirmation)
          </button>
          <button type="button" onClick={() => setEditing(false)} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", fontSize: 15 }}>
            Cancel
          </button>
        </form>
      )}
      {low && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={busy}
            style={{ ...btnQuiet, minHeight: 40, fontSize: 16 }}
            onClick={() =>
              run(async () => {
                const r = await getJson<{ sent: boolean; reason?: string }>("/api/hc/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: a }) }).catch((e) => ({
                  sent: false,
                  reason: (e as Error).message,
                }));
                if (r.sent) {
                  setNote("2 test USDC are on their way. They arrive in a few seconds.");
                  setTimeout(() => void who.refresh(), 4000);
                } else setNote(r.reason === "already sent" ? "This account already got its test USDC. More at faucet.circle.com (Arc testnet)." : `No test USDC right now: ${r.reason}. Try faucet.circle.com (Arc testnet).`);
              })
            }
          >
            Get 2 test USDC
          </button>
          <span style={{ fontSize: 14, color: C.muted }}>
            Free test money for trying HonorCat, once per account. More at{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
              faucet.circle.com
            </a>
            .
          </span>
        </div>
      )}
      {note && <p style={{ margin: 0, fontSize: 14, color: C.body }}>{note}</p>}
    </div>
  );
}
