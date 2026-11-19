"use client";

import { useEffect } from "react";

/**
 * Remembers a referral link (?ref=<code>, or an older ?ref=<account>) on this device. The referrer is recorded on-chain once,
 * before the player's first v2 pot (lib/hc.ts maybeSetReferrer); a link opened later never replaces it.
 */
export function RefCapture() {
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;
    const keep = (account: string) => {
      try {
        if (!localStorage.getItem("hc.ref")) localStorage.setItem("hc.ref", account);
      } catch {}
    };
    // Old links carry the account itself; new ones a short code (no address in the link).
    if (/^0x[0-9a-fA-F]{40}$/.test(ref)) keep(ref);
    else if (/^[0-9a-z]{6,16}$/.test(ref))
      fetch(`/api/hc/ref?code=${ref}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { account?: string } | null) => j?.account && keep(j.account))
        .catch(() => {});
  }, []);
  return null;
}
