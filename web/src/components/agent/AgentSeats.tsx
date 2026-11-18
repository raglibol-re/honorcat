"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { C, F } from "@/components/cat/tokens";
import { HelperCat } from "@/components/helper/Helper";
import { useActor } from "@/components/pot/Who";
import { createSeat, revokeSeat, seatsOf, type SeatView } from "@/lib/agent";
import { formatDate } from "@/lib/format";
import { plainError } from "@/lib/messages";
import { connectMessage, connectorLink } from "@/lib/grokBot";

import { Button } from "@/components/ui/Button";
const mono: React.CSSProperties = { fontFamily: F.mono, fontSize: 13, overflowWrap: "anywhere", background: C.panel, border: `1px solid ${C.faint}`, padding: "6px 8px" };

/**
 * The player's agent seats (their Grok Bot): create one (the secret token is shown once), see what
 * each did, revoke any at once. A seat plays the player's practice pots as an opponent, or minds the
 * player's own pots as a cat sitter with the powers chosen on that pot's page. Testnet only.
 */
export function AgentSeats() {
  const who = useActor();
  const me = who.actor?.account ?? null;
  const [seats, setSeats] = useState<SeatView[] | null>(null);
  const [label, setLabel] = useState("My Grok Bot");
  const [fresh, setFresh] = useState<{ token: string; label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      setSeats((await seatsOf(me)).seats);
    } catch {
      /* keep the last list */
    }
  }, [me]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const run = async (k: string, f: () => Promise<void>) => {
    setBusy(k);
    setErr(null);
    try {
      await f();
      await load();
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(null);
    }
  };
  const copy = async (v: string, what: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(what);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      /* the value is on screen to copy by hand */
    }
  };

  return (
    <section id="agents" style={{ display: "flex", flexDirection: "column", gap: 14, borderTop: `1.5px solid ${C.ink}`, paddingTop: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
        <HelperCat pose="sit" size={56} label="A cat sitting at its post: your agent" />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 30, fontWeight: 600, lineHeight: 1 }}>Your Grok Bot</h2>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: C.body }}>
            It can play practice pots with you or mind your pots. It never withdraws. <Link href="/grok-bot">How it works</Link>
          </p>
        </div>
      </div>
      {!who.actor ? null : (
        <>
          {fresh && (
            <div role="status" style={{ display: "flex", flexDirection: "column", gap: 8, border: `2px solid ${C.ink}`, padding: "12px 14px" }}>
              <strong style={{ fontSize: 17 }}>Seat “{fresh.label}” is ready. Copy the message and paste it into your Grok Bot: it is shown only this once.</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button onClick={() => copy(connectMessage(fresh.token), "msg")}>
                  {copied === "msg" ? "Copied" : "Copy the message for Grok Bot"}
                </Button>
                <Button variant="quiet" style={{ minHeight: 44, fontSize: 15 }} onClick={() => copy(connectorLink(fresh.token), "link")}>
                  {copied === "link" ? "Copied" : "Copy only the connector link"}
                </Button>
              </div>
              <code style={mono}>{connectorLink(fresh.token)}</code>
              <button type="button" style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, textDecoration: "underline", cursor: "pointer", fontSize: 14 }} onClick={() => setFresh(null)}>
                Done
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("create", async () => {
                const r = await createSeat(who.actor!, label);
                setFresh({ token: r.token, label: r.label });
              });
            }}
            style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Name of the seat</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} style={{ minHeight: 44, padding: "0 10px", border: `1.5px solid ${C.ink}`, background: C.page, fontSize: 16 }} />
            </label>
            <Button type="submit" disabled={!!busy}>
              {busy === "create" ? "Confirm…" : "Give my Grok Bot a seat"}
            </Button>
          </form>
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>A seat lasts 24 hours. You can revoke it any time.</p>
          {seats && seats.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1px solid ${C.faint}` }}>
              {seats.map((s) => (
                <li key={s.id} style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.faint}` }}>
                  <strong style={{ fontSize: 16 }}>{s.label}</strong>
                  <span style={{ fontSize: 14, color: C.muted }}>
                    {s.active ? `active until ${formatDate(Date.parse(s.expiresAt))}` : s.revokedAt ? "revoked" : "expired"} · {s.pots} pots · {s.actions} actions
                  </span>
                  {s.active && (
                    <Button variant="quiet" style={{ minHeight: 36, fontSize: 14 }} disabled={!!busy} onClick={() => run(`revoke-${s.id}`, async () => void (await revokeSeat(who.actor!, s.id)))}>
                      {busy === `revoke-${s.id}` ? "Confirm…" : "Revoke"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {err && (
        <p role="alert" style={{ margin: 0, color: C.signalInk }}>
          {err}
        </p>
      )}
    </section>
  );
}
