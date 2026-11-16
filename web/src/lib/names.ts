"use client";

import { useEffect, useState } from "react";
import { getJson } from "./api";
import { short } from "./format";
import { joinChallenge, signChallenge } from "./passkey";
import type { Actor } from "./hc";

const cache = new Map<string, string>();

/** Display names for these accounts (lower-case keys), refreshed every 30 s. */
export function useNames(accounts: (string | null | undefined)[]) {
  const list = [...new Set(accounts.filter((a): a is string => !!a).map((a) => a.toLowerCase()))].sort();
  const key = list.join(",");
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () =>
      getJson<{ names: Record<string, string> }>(`/api/hc/names?accounts=${key}`)
        .then((r) => {
          Object.entries(r.names).forEach(([k, v]) => cache.set(k, v));
          if (alive) setNames(r.names);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key]);
  return names;
}

/**
 * How to call an account: "you", its display name, "the practice cat", or a neutral word; the
 * address only when technical details are on.
 */
export function displayName(account: string | null | undefined, names: Record<string, string>, me: string | null | undefined, tech: boolean, fallback = "a player") {
  if (!account) return "open seat";
  const a = account.toLowerCase();
  const n = names[a] ?? cache.get(a);
  const base = me && a === me.toLowerCase() ? (n ? `you (${n})` : "you") : (n ?? fallback);
  return tech ? `${base} · ${short(account)}` : base;
}

export const nameMessage = (account: string, name: string, issuedAt: string) =>
  `HonorCat: call me "${name}" on HonorCat.\nAccount: ${account.replace(/^0x/, "0x")}\nIssued: ${issuedAt}`;

/** Sets the actor's display name with one signature (wallet) or passkey confirmation. */
export async function setMyName(actor: Actor, name: string) {
  const { getAddress } = await import("viem");
  const issuedAt = new Date().toISOString();
  const message = `HonorCat: call me "${name}" on HonorCat.\nAccount: ${getAddress(actor.account)}\nIssued: ${issuedAt}`;
  const body =
    actor.kind === "wallet"
      ? { account: actor.account, name, issuedAt, signature: await actor.adapter.signMessage!(message) }
      : { account: actor.account, name, issuedAt, passkey: await signChallenge(actor.session, await joinChallenge(message)) };
  const r = await getJson<{ name: string }>("/api/hc/names", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  cache.set(actor.account.toLowerCase(), r.name);
  return r.name;
}
