"use client";

import { useEffect, useState } from "react";
import type { Cosmetic } from "@/components/cat/Cat";
import { getJson } from "./api";
import { short } from "./format";
import { joinChallenge, signChallenge } from "./passkey";
import type { Actor } from "./hc";

const cache = new Map<string, string>();
const furCache = new Map<string, Fur>();
/** Cosmetics unlocked by honor record milestones, as the names API reports them (worn everywhere). */
const wearCache = new Map<string, Cosmetic>();
const WEARS = new Set<string>(["bell", "scarf", "bow", "hat", "crown"]);
export const wearOf = (account: string | null | undefined): Cosmetic | null => (account ? (wearCache.get(account.toLowerCase()) ?? null) : null);
const loaded = new Set<string>();
/** Whether this account's name and cat have been read from the server at least once. */
export const namesLoaded = (account: string | null | undefined) => !!account && loaded.has(account.toLowerCase());

/**
 * The fur colours a player's cat can have (relay/src/names.ts FURS). Light furs get an ink outline
 * so they show on the page colour. The market cat on the rope is always HonorCat's black cat.
 */
export const FURS = {
  black: { label: "Black", hex: "#111111", light: false },
  grey: { label: "Grey", hex: "#77736C", light: false },
  ginger: { label: "Ginger", hex: "#C9682A", light: false },
  brown: { label: "Brown", hex: "#6B4A30", light: false },
  cream: { label: "Cream", hex: "#E2D2AE", light: true },
  white: { label: "White", hex: "#FAF8F3", light: true },
} as const;
export type Fur = keyof typeof FURS;
export const FUR_KEYS = Object.keys(FURS) as Fur[];

/** A player's fur: the one they picked, else a stable one from their address (never black). */
export function furOf(account: string | null | undefined): Fur {
  if (!account) return "black";
  const a = account.toLowerCase();
  // Never black by default: black is HonorCat's own cat on the rope.
  const auto = FUR_KEYS.filter((f) => f !== "black");
  return furCache.get(a) ?? auto[(parseInt(a.slice(-4), 16) || 0) % auto.length]!;
}
/** Whether this account picked its own cat (name and fur) yet. */
export const hasOwnCat = (account: string | null | undefined, names: Record<string, string>) => !!account && !!names[account.toLowerCase()] && furCache.has(account.toLowerCase());

/** Display names for these accounts (lower-case keys), refreshed every 30 s. */
export function useNames(accounts: (string | null | undefined)[]) {
  const list = [...new Set(accounts.filter((a): a is string => !!a).map((a) => a.toLowerCase()))].sort();
  const key = list.join(",");
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () =>
      getJson<{ names: Record<string, string>; furs?: Record<string, string>; wear?: Record<string, string> }>(`/api/hc/names?accounts=${key}`)
        .then((r) => {
          Object.entries(r.names).forEach(([k, v]) => cache.set(k, v));
          Object.entries(r.furs ?? {}).forEach(([k, v]) => v in FURS && furCache.set(k, v as Fur));
          Object.entries(r.wear ?? {}).forEach(([k, v]) => WEARS.has(v) && wearCache.set(k, v as Cosmetic));
          key.split(",").forEach((k) => loaded.add(k));
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

const NICKNAMES = [
  "Mittens", "Pepper", "Biscuit", "Tabby", "Socks", "Ginger", "Mochi", "Pixel", "Nutmeg", "Clover", "Pumpkin", "Shadow", "Toffee", "Juniper", "Marble", "Saffron",
  "Pebble", "Hazel", "Comet", "Velvet", "Maple", "Olive", "Sesame", "Cricket", "Bramble", "Willow", "Sprout", "Tofu", "Paprika", "Moss", "Echo", "Puddle",
];

/** A stable cat nickname for an account without a display name (no address shown). */
export function nickname(account: string): string {
  const h = parseInt(account.slice(-6), 16) || 0;
  return NICKNAMES[h % NICKNAMES.length]!;
}

/**
 * How to call an account: "you", its display name, "the practice cat", or a stable cat nickname;
 * the address only when technical details are on.
 */
export function displayName(account: string | null | undefined, names: Record<string, string>, me: string | null | undefined, tech: boolean, fallback = "a player") {
  if (!account) return "open seat";
  const a = account.toLowerCase();
  const n = names[a] ?? cache.get(a) ?? (fallback === "a player" ? nickname(a) : undefined);
  const base = me && a === me.toLowerCase() ? (n ? `you (${n})` : "you") : (n ?? fallback);
  return tech ? `${base} · ${short(account)}` : base;
}

/**
 * Sets the actor's cat: its name and fur, with one signature (wallet) or passkey confirmation.
 * Display only; the relay never uses names to authorise anything.
 */
export async function setMyName(actor: Actor, name: string, fur?: Fur | null) {
  const { getAddress } = await import("viem");
  const issuedAt = new Date().toISOString();
  const message = `HonorCat: call me "${name}" on HonorCat.${fur ? `\nMy cat's fur: ${fur}` : ""}\nAccount: ${getAddress(actor.account)}\nIssued: ${issuedAt}`;
  const body =
    actor.kind === "wallet"
      ? { account: actor.account, name, fur, issuedAt, signature: await actor.adapter.signMessage!(message) }
      : { account: actor.account, name, fur, issuedAt, passkey: await signChallenge(actor.session, await joinChallenge(message)) };
  const r = await getJson<{ name: string; fur: Fur | null }>("/api/hc/names", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  cache.set(actor.account.toLowerCase(), r.name);
  if (r.fur) furCache.set(actor.account.toLowerCase(), r.fur);
  return r.name;
}
