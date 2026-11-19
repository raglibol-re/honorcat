"use client";

import { useState } from "react";
import { getAddress } from "viem";
import { C } from "@/components/cat/tokens";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { getJson, pollFast } from "@/lib/api";
import { plainError } from "@/lib/messages";
import { joinChallenge, signChallenge } from "@/lib/passkey";
import { SITE_URL } from "@/lib/site";
import { setPotKey } from "@/lib/potKey";
import type { ActorState } from "./Who";

/**
 * For a pot's players: "Make this pot private" (one signature; nothing moves), and once private, the
 * link that lets someone else see it. Private pots stay out of every list and every leaderboard amount.
 */
export function PrivateControl({ potId, who, isPrivate, privateKey }: { potId: string; who: ActorState; isPrivate: boolean; privateKey: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!who.actor) return null;
  if (isPrivate)
    return (
      <p style={{ margin: 0, fontSize: 15, color: C.body }}>
        Private: only the players and people with the link see this pot{privateKey ? ": " : "."}
        {privateKey && <code style={{ fontSize: 13, wordBreak: "break-all" }}>{`${SITE_URL}/pots/${potId}?k=${privateKey}`}</code>}
      </p>
    );
  const make = async () => {
    const actor = who.actor!;
    setBusy(true);
    setErr(null);
    try {
      const issuedAt = new Date().toISOString();
      const message = `HonorCat: make pot ${potId} private.\nAccount: ${getAddress(actor.account)}\nIssued: ${issuedAt}`;
      const proof = actor.kind === "wallet" ? { signature: await actor.adapter.signMessage!(message) } : { passkey: await signChallenge(actor.session, await joinChallenge(message)) };
      const r = await getJson<{ key: string }>(`/api/hc/pots/${potId}/private`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: actor.account, issuedAt, ...proof }) });
      setPotKey(potId, r.key);
      toast("This pot is private now: only its players and people with the link see it.");
      pollFast();
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 15 }}>
      <Button variant="quiet" size="sm" busy={busy} onClick={make}>
        Make this pot private
      </Button>
      <span style={{ color: C.muted }}>Only the players and people with the link will see it; it leaves every list.</span>
      {err && <span style={{ color: C.signalInk }}>{err}</span>}
    </div>
  );
}

/**
 * On a private pot without its link: a player proves it with one signature and gets the link's key,
 * which this device then remembers. Others cannot (the relay checks the signer holds a side).
 */
export function UnlockPrivate({ potId, who }: { potId: string; who: ActorState }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!who.actor) return <p style={{ margin: 0, fontSize: 15, color: C.muted }}>A player of this pot can sign in to open it.</p>;
  const unlock = async () => {
    const actor = who.actor!;
    setBusy(true);
    setErr(null);
    try {
      const issuedAt = new Date().toISOString();
      const message = `HonorCat: show me the private link of pot ${potId}.
Account: ${getAddress(actor.account)}
Issued: ${issuedAt}`;
      const proof = actor.kind === "wallet" ? { signature: await actor.adapter.signMessage!(message) } : { passkey: await signChallenge(actor.session, await joinChallenge(message)) };
      const r = await getJson<{ key: string | null }>(`/api/hc/pots/${potId}/private`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "key", account: actor.account, issuedAt, ...proof }) });
      if (r.key) {
        setPotKey(potId, r.key);
        window.location.replace(`/pots/${potId}?k=${encodeURIComponent(r.key)}`);
      }
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
      <Button variant="quiet" busy={busy} onClick={unlock}>
        I play in this pot: open it
      </Button>
      {err && <span style={{ color: C.signalInk, fontSize: 15 }}>{err}</span>}
    </div>
  );
}
