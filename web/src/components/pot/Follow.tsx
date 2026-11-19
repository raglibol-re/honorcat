"use client";

import { useState } from "react";
import { getAddress } from "viem";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { getJson, usePolling } from "@/lib/api";
import { plainError } from "@/lib/messages";
import { joinChallenge, signChallenge } from "@/lib/passkey";
import type { ActorState } from "./Who";

type Follows = { account: string; following: string[]; followers: number };

/** The same message the relay checks (social.ts followMessage). */
const followMessage = (leader: string, follow: boolean, account: string, issuedAt: string) =>
  `HonorCat: ${follow ? "follow" : "stop following"} ${getAddress(leader)}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

/** Follows or stops following, signed the way notes are (a wallet signature or one passkey confirmation). */
export async function setFollow(who: ActorState, leader: string, follow: boolean) {
  const actor = who.actor!;
  const issuedAt = new Date().toISOString();
  const message = followMessage(leader, follow, actor.account, issuedAt);
  const proof =
    actor.kind === "wallet" ? { signature: await actor.adapter.signMessage!(message) } : { passkey: await signChallenge(actor.session, await joinChallenge(message)) };
  return getJson<Follows>("/api/hc/follows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: actor.account, leader, follow, issuedAt, ...proof }),
  });
}

/** Who the signed-in player follows (null while signed out or loading). */
export function useFollowing(who: ActorState) {
  const me = who.actor?.account ?? null;
  return usePolling<Follows>(me ? `/api/hc/follows?account=${me}` : null, 60_000);
}

/** "Follow" / "Following" for a player; hidden for yourself and while signed out. */
export function FollowButton({ who, leader, name }: { who: ActorState; leader: string; name: string }) {
  const mine = useFollowing(who);
  const [local, setLocal] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const me = who.actor?.account.toLowerCase() ?? null;
  if (!me || me === leader.toLowerCase()) return null;
  const on = local ?? !!mine.data?.following.includes(leader.toLowerCase());
  return (
    <Button
      variant={on ? "quiet" : "primary"}
      size="sm"
      busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await setFollow(who, leader, !on);
          setLocal(r.following.includes(leader.toLowerCase()));
          toast(on ? `You no longer follow ${name}.` : `You follow ${name}: their new pots show in your feed.`);
        } catch (e) {
          toast(plainError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {on ? "Following" : "Follow"}
    </Button>
  );
}
