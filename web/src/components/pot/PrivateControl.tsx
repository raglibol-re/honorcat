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
      await getJson<{ key: string }>(`/api/hc/pots/${potId}/private`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: actor.account, issuedAt, ...proof }) });
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
