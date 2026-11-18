"use client";

import { useEffect } from "react";

/**
 * Remembers a referral link (?ref=<account>) on this device. The referrer is recorded on-chain once,
 * before the player's first v2 pot (lib/hc.ts maybeSetReferrer); a link opened later never replaces it.
 */
export function RefCapture() {
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref || !/^0x[0-9a-fA-F]{40}$/.test(ref)) return;
    try {
      if (!localStorage.getItem("hc.ref")) localStorage.setItem("hc.ref", ref);
    } catch {}
  }, []);
  return null;
}
