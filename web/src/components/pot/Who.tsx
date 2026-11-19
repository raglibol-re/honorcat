"use client";

import { plainError } from "@/lib/messages";
import { useCallback, useEffect, useState } from "react";
import { erc20Abi, type Address } from "viem";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { C, F } from "@/components/cat/tokens";
import { publicClient, USDC_ADDRESS, addressUrl } from "@/lib/chain";
import { getJson } from "@/lib/api";
import { FUR_KEYS, FURS, furOf, hasOwnCat, namesLoaded, nickname, setMyName, useNames, type Fur } from "@/lib/names";
import { CatName, PlayerCat } from "@/components/cat/PlayerCat";
import { useTechMode } from "@/components/TechMode";
import { short } from "@/lib/format";
import type { Actor } from "@/lib/hc";
import { createPasskey, forgetPasskey, passkeysSupported, savedPasskey, signInWithPasskey, type PasskeySession } from "@/lib/passkey";
import { useWallet } from "@/lib/wallet/context";
import { inEuros, money } from "@/lib/currency";

import { Button, ButtonLink } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
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
  // Why HonorCat's pool could not send test money (empty or at its daily limit), if it could not.
  const [fundsNote, setFundsNote] = useState<string | null>(null);

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
  // Welcome test money on first sign-in (passkey or wallet), once per account; nothing to click.
  useEffect(() => {
    if (!account) return;
    const key = `honorcat.welcomed.${account.toLowerCase()}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      /* private mode: the server still sends it only once */
    }
    toast("Welcome. HonorCat is sending you test money to play with.");
    void getJson<{ sent: boolean; reason?: string }>("/api/hc/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) })
      .then((r) => {
        // Remembered only once it worked (or was already done), so a failed send is tried again next time.
        if (r.sent || r.reason === "already welcomed") {
          try {
            localStorage.setItem(key, "1");
          } catch {}
        }
        if (r.sent) toast("Your test money has arrived.");
        else if (r.reason && r.reason !== "already welcomed") setFundsNote(r.reason);
      })
      .catch((e) => setFundsNote((e as Error).message));
  }, [account]);
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
    fundsNote,
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
      setErr(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: C.body }}>{purpose}</p>
      {supported && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Button disabled={busy} onClick={() => run(createPasskey)}>
            Create a passkey
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => run(signInWithPasskey)}>
            I have one
          </Button>
        </div>
      )}
      {who.wallet.circle.isAvailable() && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${C.faint}`, paddingTop: 12 }}>
          <span style={{ fontSize: 15, color: C.body }}>
            Or a <strong>Circle smart account</strong>: a passkey-owned smart account on Arc from Circle; Circle pays its network fees.
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {(["register", "login"] as const).map((m) => (
              <Button
                variant={m === "register" ? "primary" : "quiet"}
                key={m}
                disabled={busy || who.wallet.connecting}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    who.wallet.circle.mode = m;
                    await who.wallet.circle.connect();
                    who.wallet.setKind("circle");
                    who.useWalletInstead();
                  } catch (e) {
                    setErr(plainError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {m === "register" ? "Create a Circle smart account" : "I have a Circle smart account"}
              </Button>
            ))}
          </div>
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
/**
 * `askCat`: open the cat picker on its own for a player without a cat (the account page). Elsewhere
 * it is only offered as a link, so it never interrupts a pot being made or joined.
 */
export function AccountLine({ who, askCat = false }: { who: ActorState; askCat?: boolean }) {
  const { tech } = useTechMode();
  const a = who.actor?.account ?? null;
  const names = useNames([a]);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!who.actor || !a) return null;
  const myName = names[a.toLowerCase()];
  const picked = hasOwnCat(a, names);
  const low = who.balance !== null && who.balance < 2_000_000n;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {((askCat && !picked && namesLoaded(a)) || editing) && (
        <CatPicker
          who={who}
          first={!picked}
          initialName={myName ?? nickname(a)}
          initialFur={furOf(a)}
          onDone={(n) => {
            setEditing(false);
            setNote(n);
          }}
          onCancel={picked ? () => setEditing(false) : undefined}
        />
      )}
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: C.muted }}>
        Playing as <strong style={{ color: C.ink }}><CatName account={a} name={myName ?? nickname(a)} /></strong>
        {who.actor.kind === "wallet" && who.wallet.kind === "circle" ? " (Circle smart account)" : ""}{" "}
        {!editing && !(askCat && !picked) && (
          <button type="button" onClick={() => setEditing(true)} style={{ background: "none", border: 0, padding: 0, color: C.muted, textDecoration: "underline", cursor: "pointer", fontSize: 15 }}>
            {picked ? "change your cat" : "name your cat"}
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
        · holds <strong style={{ color: C.ink }}>{who.balance === null ? "…" : inEuros() ? `${money(who.balance)} (in test USDC)` : money(who.balance)}</strong> (test money).
        {who.actor.kind === "wallet" && who.wallet.kind === "circle" && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => (who.wallet.circle.forget(), who.wallet.setKind("evm"))}
              style={{ background: "none", border: 0, padding: 0, color: C.muted, textDecoration: "underline", cursor: "pointer", fontSize: 15 }}
            >
              Sign out
            </button>
          </>
        )}
        {who.actor.kind === "passkey" && (
          <>
            {" "}
            <button type="button" onClick={who.signOut} style={{ background: "none", border: 0, padding: 0, color: C.muted, textDecoration: "underline", cursor: "pointer", fontSize: 15 }}>
              Sign out
            </button>
          </>
        )}
      </p>
      {low && !who.fundsNote && <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Test money is added to your account automatically when a pot needs it.</p>}
      {low && who.fundsNote && <FundsHelp account={a} reason={who.fundsNote} />}
      {note && <p style={{ margin: 0, fontSize: 14, color: C.body }}>{note}</p>}
    </div>
  );
}

/**
 * Pick your cat: a fur colour and a name. This is how others see you everywhere (on the rope, in
 * invitations, lists and the honor record); your address stays under "Show technical details".
 * Saved with one signature or passkey confirmation. Display only: never used to authorise anything.
 */
export function CatPicker({
  who,
  first,
  initialName,
  initialFur,
  onDone,
  onCancel,
}: {
  who: ActorState;
  first: boolean;
  initialName: string;
  initialFur: Fur;
  onDone: (note: string) => void;
  onCancel?: () => void;
}) {
  const [fur, setFur] = useState<Fur>(initialFur);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const clean = name.replace(/\s+/g, " ").trim();
  const bad = clean.length < 2 ? "At least 2 characters." : clean.length > 20 ? "At most 20 characters." : null;
  return (
    <form
      aria-label="Your cat"
      onSubmit={async (e) => {
        e.preventDefault();
        if (bad || !who.actor) return;
        setBusy(true);
        setErr(null);
        try {
          const n = await setMyName(who.actor, clean, fur);
          onDone(`Saved. Others now see ${n}, your ${FURS[fur].label.toLowerCase()} cat, instead of your address.`);
        } catch (x) {
          setErr(plainError(x));
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px", border: `1.5px solid ${C.ink}`, maxWidth: 620 }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <PlayerCat fur={fur} pose="sit" size={86} mood="up" />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <strong style={{ fontFamily: F.cond, fontSize: 26, fontWeight: 600, lineHeight: 1 }}>{first ? "Pick your cat" : "Change your cat"}</strong>
          <span style={{ fontSize: 15, lineHeight: 1.45, color: C.body }}>Others see your cat and its name, never your address.</span>
        </div>
      </div>
      <div role="radiogroup" aria-label="Fur colour" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {FUR_KEYS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={fur === f}
            aria-label={FURS[f].label}
            onClick={() => setFur(f)}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 8px", minWidth: 64, minHeight: 44, background: "transparent", cursor: "pointer", border: fur === f ? `2.5px solid ${C.ink}` : `1px solid ${C.faint}` }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <PlayerCat fur={f} pose="face" size={30} label="" />
            </span>
            <span style={{ fontSize: 13, color: C.ink }}>{FURS[f].label}</span>
          </button>
        ))}
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Your cat&apos;s name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          autoComplete="nickname"
          style={{ minHeight: 44, padding: "0 10px", border: `1.5px solid ${C.ink}`, background: C.page, fontFamily: F.sans, fontSize: 17, maxWidth: 320 }}
        />
      </label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Button type="submit" disabled={busy || !!bad} style={{ minHeight: 44, fontSize: 17 }}>
          {busy ? "Confirm in your passkey or wallet…" : "This is my cat"}
        </Button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", fontSize: 15 }}>
            Keep the current one
          </button>
        )}
        <span style={{ fontSize: 14, color: C.muted }}>{bad ?? "One confirmation; it costs nothing."}</span>
      </div>
      {err && (
        <p role="alert" style={{ margin: 0, color: C.signalInk, fontSize: 15 }}>
          {err}
        </p>
      )}
    </form>
  );
}

/**
 * When HonorCat's test-money pool cannot help (empty, or today's amount given out), say so plainly
 * and offer Circle's faucet: one link and the account's address, copied with one click.
 */
export function FundsHelp({ account, reason }: { account: string; reason?: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", border: `1.5px solid ${C.signal}`, maxWidth: 720 }}>
      <strong style={{ fontSize: 16 }}>HonorCat&apos;s test money is used up for the moment</strong>
      <span style={{ fontSize: 15, lineHeight: 1.5, color: C.body }}>
        {reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/[.;]?$/, ".")} ` : ""}
        It refills by itself every few hours. If you do not want to wait, Circle&apos;s free faucet sends you test USDC in a minute: open it, choose{" "}
        <strong>Arc Testnet</strong>, paste your address and request USDC.
      </span>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="quiet"
          style={{ minHeight: 40, fontSize: 16 }}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(account);
              setCopied(true);
              setTimeout(() => setCopied(false), 3000);
            } catch {
              /* the address is shown below to copy by hand */
            }
          }}
        >
          {copied ? "Address copied" : "Copy my address"}
        </Button>
        <ButtonLink href="https://faucet.circle.com" size="sm">
          Open Circle&apos;s faucet
        </ButtonLink>
      </div>
      <span style={{ fontFamily: F.mono, fontSize: 13, color: C.muted, overflowWrap: "anywhere" }}>{account}</span>
      <span style={{ fontSize: 14, color: C.muted }}>
        Have USDC on another chain? <a href="/account#gateway">Bring it over with Circle Gateway</a>.
      </span>
    </div>
  );
}
