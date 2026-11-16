import type { HcPot } from "@/lib/hc";
import { short } from "@/lib/format";
import type { RopeProps } from "./Rope";

/** What the rope shows for a pot right now (shared by the pot page and the TV view). */
export function sceneOf(pot: HcPot, price: number | null, nowS: number, me?: string | null): Omit<RopeProps, "trail" | "speed" | "big"> {
  const d = pot.data;
  const name = (a: string | null) => (!a ? "open seat" : me && a.toLowerCase() === me.toLowerCase() ? "you" : short(a));
  const names = { yes: name(pot.owners.yes), no: name(pot.owners.no) };
  if (pot.state === "Joining") {
    const joiner = d.joiner;
    if (Number(d.creatorSide) === 0) names.no = name(joiner);
    else names.yes = name(joiner);
  }
  const levels = { yes: d.levels?.[0] ?? null, no: d.levels?.[1] ?? null };
  // After a full division the pot's notional is 0: show the pot it was (deposits are kept on-chain).
  const initial = (d as { initialNotional?: string }).initialNotional;
  const notional = BigInt(d.notional !== "0" ? d.notional : initial && initial !== "0" ? initial : (BigInt(d.depYes) + BigInt(d.depNo)).toString());
  const start = Number(d.requestTime) + 1;
  const win = { start, end: start + Number(d.window), now: nowS };
  const lastDivision = pot.requests.find((r) => r.kind === "window" && r.payload.kind === 1 && r.status === "submitted" && r.payload.attestation?.valid);
  const stamp = lastDivision?.payload.attestation ? `Exit at ${(lastDivision.payload.attestation.priceYes / 10_000).toFixed(1)}%` : null;

  switch (pot.state) {
    case "Open":
      return { price, notional, names, phase: "waiting", levels };
    case "Joining":
      return { price, notional, names, phase: "joining", levels, window: { label: "Entry price", ...win } };
    case "Live":
      return { price, notional, names, phase: "live", levels, stamp: null };
    case "ExitRequested":
      return { price, notional, names, phase: "exit", levels, window: { label: `${Number(d.exitSide) === 0 ? "YES" : "NO"} is leaving. Exit price`, ...win } };
    case "Divided":
      return { price: lastDivision?.payload.attestation ? lastDivision.payload.attestation.priceYes / 1e6 : price, notional, names, phase: "divided", stamp };
    case "Settled": {
      const o = pot.requests.find((r) => r.kind === "outcome")?.payload as { attestation?: { outcome: number } } | undefined;
      const outcome = o?.attestation?.outcome;
      return { price, notional, names, phase: "settled", receiver: outcome === 1 ? 0 : outcome === 0 ? 1 : 2 };
    }
    default:
      return { price, notional, names, phase: "expired" };
  }
}

export const STATE_TEXT: Record<string, string> = {
  Open: "Waiting for someone to take the other side.",
  Joining: "Someone is joining. The entry price is the 30-second average starting now.",
  Live: "Live. Each side's share follows the price; either side can leave at its share.",
  ExitRequested: "A side asked to leave. The exit price is the 30-second average starting at the request.",
  Divided: "Divided: both sides were paid their shares.",
  Settled: "Settled by Gemini's result.",
  Expired: "Closed: every deposit went back.",
};
