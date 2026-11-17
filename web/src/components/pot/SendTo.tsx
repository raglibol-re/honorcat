"use client";

import { useEffect, useId, useState } from "react";
import type { Address, Hex } from "viem";
import { PlayerCat } from "@/components/cat/PlayerCat";
import { C, F } from "@/components/cat/tokens";
import { FeeNote, useFees } from "@/components/pot/Receipts";
import { txUrl } from "@/lib/chain";
import type { Actor } from "@/lib/hc";
import { plainError } from "@/lib/messages";
import { FUR_KEYS, type Fur } from "@/lib/names";
import { findPlayers, sendUsdc, type Player } from "@/lib/send";

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (base: bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;
const furOf = (f: string | null): Fur | undefined => (f && (FUR_KEYS as string[]).includes(f) ? (f as Fur) : undefined);

const field: React.CSSProperties = { fontFamily: F.sans, fontSize: 17, minHeight: 48, padding: "0 12px", border: `1.5px solid ${C.ink}`, background: C.panel, color: C.ink, width: "100%", boxSizing: "border-box" };
const solid: React.CSSProperties = { minHeight: 48, padding: "0 20px", background: C.ink, color: C.page, border: 0, fontFamily: F.sans, fontSize: 17, fontWeight: 600, cursor: "pointer" };
const quiet: React.CSSProperties = { ...solid, background: "transparent", color: C.ink, border: `1.5px solid ${C.ink}` };

/**
 * Send test USDC to another player by their HonorCat name. Names are not unique, so each match
 * shows its cat and short address, and the last step repeats both before anything is sent.
 */
export function SendTo({ actor, balance, amount, potId, title = "Send to a player" }: { actor: Actor; balance: bigint | null; amount?: bigint; potId?: string; title?: string }) {
  const id = useId();
  const fees = useFees();
  const [q, setQ] = useState("");
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [pick, setPick] = useState<Player | null>(null);
  const [dollars, setDollars] = useState(amount ? (Number(amount) / 1e6).toFixed(2) : "");
  const [confirm, setConfirm] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; tx: Hex } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      findPlayers(q)
        .then((p) => live && setPlayers(p.filter((x) => x.account.toLowerCase() !== actor.account.toLowerCase())))
        .catch(() => live && setPlayers([]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, actor.account]);

  const value = /^\d+(\.\d{0,2})?$/.test(dollars.trim()) ? BigInt(Math.round(Number(dollars) * 100)) * 10_000n : null;
  const tooMuch = value !== null && balance !== null && value > balance;
  const ready = !!pick && value !== null && value > 0n && !tooMuch;
  const nameOf = (p: Player) => p.name ?? "an account without a name";

  async function send() {
    if (!pick || !value) return;
    setErr(null);
    try {
      const tx = await sendUsdc(actor, pick.account as Address, value, potId, setStep);
      setDone({ text: `Sent ${usd(value)} to ${nameOf(pick)}.`, tx });
      setConfirm(false);
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setStep(null);
    }
  }

  if (done)
    return (
      <p role="status" style={{ margin: 0, fontSize: 17 }}>
        {done.text}{" "}
        <a href={txUrl(done.tx)} target="_blank" rel="noreferrer">
          The transfer on Arc
        </a>
        .{" "}
        <button type="button" onClick={() => { setDone(null); setPick(null); setQ(""); setPlayers(null); }} style={{ background: "none", border: 0, padding: 0, font: "inherit", textDecoration: "underline", cursor: "pointer", color: C.ink }}>
          Send more
        </button>
      </p>
    );

  return (
    <section aria-labelledby={`${id}-h`} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
      <h2 id={`${id}-h`} style={{ margin: 0, fontFamily: F.cond, fontSize: 30, fontWeight: 600 }}>
        {title}
      </h2>
      {!confirm && (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 15, color: C.body }}>
            Their HonorCat name
            <input value={q} onChange={(e) => { setQ(e.target.value); setPick(null); if (e.target.value.trim().length < 2) setPlayers(null); }} placeholder="for example Mochi" autoComplete="off" style={field} />
          </label>
          {players && q.trim().length >= 2 && (
            players.length === 0 ? (
              <p style={{ margin: 0, fontSize: 15, color: C.muted }}>No player with that name yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span id={`${id}-pick`} style={{ fontSize: 15, color: C.body }}>Pick the right cat: names are not unique</span>
                <div role="radiogroup" aria-labelledby={`${id}-pick`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {players.map((p) => {
                    const on = pick?.account === p.account;
                    return (
                      <button
                        key={p.account}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${nameOf(p)}, ${shortAddr(p.account)}`}
                        onClick={() => setPick(p)}
                        style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "6px 10px", border: `${on ? 2.5 : 1.5}px solid ${on ? C.ink : C.faint}`, background: on ? C.panel : "transparent", color: C.ink, font: "inherit", textAlign: "left", cursor: "pointer" }}
                      >
                        <span aria-hidden="true" style={{ width: 30, flex: "none" }}>
                          <PlayerCat account={p.account} fur={furOf(p.fur)} pose="face" size={30} label="" />
                        </span>
                        <span style={{ fontSize: 17, fontWeight: 600 }}>{nameOf(p)}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.muted, marginLeft: "auto" }}>{shortAddr(p.account)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 15, color: C.body }}>
            Amount in test dollars{balance !== null ? ` (you have ${usd(balance)})` : ""}
            <input value={dollars} onChange={(e) => setDollars(e.target.value.replace(/^\$/, ""))} inputMode="decimal" placeholder="2.50" style={{ ...field, maxWidth: 180 }} />
          </label>
          {tooMuch && <p style={{ margin: 0, fontSize: 15, color: C.signalInk }}>That is more than your account holds.</p>}
          <button type="button" disabled={!ready} onClick={() => setConfirm(true)} style={{ ...solid, alignSelf: "flex-start", opacity: ready ? 1 : 0.5 }}>
            Continue
          </button>
        </>
      )}
      {confirm && pick && value && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, border: `1.5px solid ${C.ink}`, background: C.panel }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span aria-hidden="true" style={{ width: 56, flex: "none" }}>
              <PlayerCat account={pick.account} fur={furOf(pick.fur)} pose="sit" size={56} label="" />
            </span>
            <p style={{ margin: 0, fontSize: 19, lineHeight: 1.35 }}>
              Send <strong>{usd(value)}</strong> to <strong>{nameOf(pick)}</strong>, the cat shown here, at <span style={{ fontFamily: F.mono, fontSize: 15 }}>{shortAddr(pick.account)}</span>?
            </p>
          </div>
          <p style={{ margin: 0, fontSize: 15, color: C.body }}>
            Arc transfers cannot be called back. Test money only.{" "}
            <FeeNote fees={fees} kind="pot_exec" payer={actor.kind === "wallet" ? "wallet" : "honorcat"} />
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" disabled={!!step} onClick={send} style={solid}>
              {step ? `${step}…` : `Send ${usd(value)}`}
            </button>
            <button type="button" disabled={!!step} onClick={() => setConfirm(false)} style={quiet}>
              Change
            </button>
          </div>
        </div>
      )}
      {err && <p role="alert" style={{ margin: 0, color: C.signalInk }}>{err}</p>}
    </section>
  );
}
