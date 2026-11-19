"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAddress } from "viem";
import { PlayerCat } from "@/components/cat/PlayerCat";
import { C, F } from "@/components/cat/tokens";
import { getJson, usePolling } from "@/lib/api";
import type { HcPot } from "@/lib/hc";
import { plainError } from "@/lib/messages";
import { joinChallenge, signChallenge } from "@/lib/passkey";
import { type ActorState } from "./Who";

import { Button, ButtonLink } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
type Note = { account: string; kind: "well_played" | "rematch"; draft_id: string | null; created_at: string };

/** Signs a note on a pot the way names are signed: a wallet signature or one passkey confirmation. */
async function sendNote(who: ActorState, potId: string, kind: Note["kind"], draftId: string | null = null) {
  const actor = who.actor!;
  const issuedAt = new Date().toISOString();
  const message = `HonorCat: ${kind === "well_played" ? '"Well played"' : "a rematch"} on pot ${potId}.\nAccount: ${getAddress(actor.account)}\nIssued: ${issuedAt}`;
  const proof =
    actor.kind === "wallet" ? { signature: await actor.adapter.signMessage!(message) } : { passkey: await signChallenge(actor.session, await joinChallenge(message)) };
  return getJson<{ notes: Note[] }>(`/api/hc/pots/${potId}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: actor.account, kind, draftId, issuedAt, ...proof }),
  });
}

/**
 * After a pot ends: each side can send "Well played" and offer a rematch on a new market (a friend
 * draft only the other player can join). Everyone sees the notes; nothing here moves money.
 */
export function AfterPot({ pot, who, nameOf }: { pot: HcPot; who: ActorState; nameOf: (a: string | null) => string }) {
  const router = useRouter();
  const { data } = usePolling<{ notes: Note[] }>(`/api/hc/pots/${pot.potId}/notes`, 10_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<Note[] | null>(null);
  const notes = sent ?? data?.notes ?? [];
  const me = who.actor?.account.toLowerCase() ?? null;
  const players = [...new Set((pot.events ?? []).filter((e) => e.name === "Transfer" && e.args.to && !/^0x0{40}$/i.test(e.args.to)).map((e) => e.args.to!.toLowerCase()))];
  const isPlayer = !!me && players.includes(me);
  // the side this player held, for a rematch on the same market and side
  const myRole = me === pot.owners.yes?.toLowerCase() ? 0 : me === pot.owners.no?.toLowerCase() ? 1 : null;
  const practiceCat = pot.practice;
  const mine = (k: Note["kind"]) => notes.find((n) => n.account === me && n.kind === k);
  const theirRematch = notes.find((n) => n.kind === "rematch" && n.account !== me && n.draft_id);

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!notes.length && !isPlayer) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>After the pot</h2>
      {notes
        .filter((n) => n.kind === "well_played")
        .map((n) => (
          <div key={n.account} style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <PlayerCat account={n.account} pose="paw" size={70} label={`${nameOf(n.account)}'s cat holding out a paw`} />
            <span style={{ fontSize: 19 }}>
              <strong>{nameOf(n.account)}</strong>: “Well played.”
            </span>
          </div>
        ))}
      {theirRematch && (
        <p style={{ margin: 0, fontSize: 18 }}>
          <strong>{nameOf(theirRematch.account)}</strong> offers a rematch on a new market.{" "}
          {isPlayer ? (
            <a href={`/pots/together/${theirRematch.draft_id}`} style={{ fontWeight: 600 }}>
              Open the rematch
            </a>
          ) : (
            "Only the other player of this pot can take it."
          )}
        </p>
      )}
      {isPlayer && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button variant="quiet"
            disabled={!!busy || !!mine("well_played")}
            onClick={() =>
              run("well", async () => {
                setSent((await sendNote(who, pot.potId, "well_played")).notes);
              })
            }
          >
            {mine("well_played") ? "You said “Well played”" : busy === "well" ? "Confirm…" : "Send “Well played”"}
          </Button>
          {!practiceCat && (
            <Button
              disabled={!!busy}
              onClick={() =>
                run("rematch", async () => {
                  const r = await getJson<{ id: string; token: string }>("/api/hc/drafts", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ account: who.actor!.account, kind: who.actor!.kind }),
                  });
                  try {
                    localStorage.setItem(`honorcat.draft.${r.id}`, r.token);
                  } catch {
                    /* private mode: the seat lasts for this tab */
                  }
                  await sendNote(who, pot.potId, "rematch", r.id);
                  router.push(`/pots/together/${r.id}`);
                })
              }
            >
              {mine("rematch") ? "Offer another rematch" : busy === "rematch" ? "Confirm…" : "Offer a rematch on a new market"}
            </Button>
          )}
          {pot.market && myRole !== null && (
            <ButtonLink variant="quiet" href={`/pots/new?rematch=${pot.potId}&side=${myRole}`}>
              Rematch on this market
            </ButtonLink>
          )}
          <Button
            variant="quiet"
            onClick={async () => {
              const url = `${window.location.origin}/pots/${pot.potId}`;
              if (navigator.share) await navigator.share({ title: "HonorCat", text: "How our pot went", url }).catch(() => {});
              else {
                const ok = navigator.clipboard ? await navigator.clipboard.writeText(url).then(() => true, () => false) : false;
                toast(ok ? "Link copied: its preview tells what happened." : `The link: ${url}`);
              }
            }}
          >
            Share what happened
          </Button>
        </div>
      )}
      {mine("rematch")?.draft_id && (
        <p style={{ margin: 0, fontSize: 15, color: C.body }}>
          Your rematch: <a href={`/pots/together/${mine("rematch")!.draft_id}`}>pick the market together</a>. Only the other player can take the seat.
        </p>
      )}
      {err && (
        <p role="alert" style={{ margin: 0, color: C.signalInk }}>
          {err}
        </p>
      )}
    </section>
  );
}
