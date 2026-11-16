import type { HcPot } from "@/lib/hc";
import { displayName, furOf } from "@/lib/names";
import { sidesOf } from "@/lib/statement";
import type { Mood } from "@/components/cat/Cat";
import type { PostCat, RopeProps } from "./Rope";

export type NameOpts = { me?: string | null; names?: Record<string, string>; tech?: boolean };

/** What the rope shows for a pot right now (shared by the pot page, the landing and the TV view). */
export function sceneOf(pot: HcPot, price: number | null, nowS: number, o: NameOpts = {}): Omit<RopeProps, "trail" | "speed" | "big"> {
  const d = pot.data;
  const name = (a: string | null) => displayName(a, o.names ?? {}, o.me, !!o.tech, a ? "a player" : "open seat");
  const names = { yes: name(pot.owners.yes), no: name(pot.owners.no) };
  if (pot.state === "Joining") {
    if (Number(d.creatorSide) === 0) names.no = name(d.joiner);
    else names.yes = name(d.joiner);
  }
  const levels = { yes: d.levels?.[0] ?? null, no: d.levels?.[1] ?? null };
  // Each player's cat at its post. Mood: its side's price against the entry price (3 points either way).
  const owners = { yes: pot.owners.yes, no: pot.owners.no };
  if (pot.state === "Joining") {
    if (Number(d.creatorSide) === 0) owners.no = d.joiner;
    else owners.yes = d.joiner;
  }
  const dy = Number(d.depYes);
  const dn = Number(d.depNo);
  const entry = dy > 0 && dn > 0 ? dy / (dy + dn) : null;
  const moodOf = (side: 0 | 1): Mood => {
    if (entry === null || price === null) return "even";
    const move = side === 0 ? price - entry : entry - price;
    return move > 0.03 ? "up" : move < -0.03 ? "down" : "even";
  };
  const cat = (a: string | null, side: 0 | 1, nm: string): PostCat | null => (a && !/^0x0{40}$/i.test(a) ? { fur: furOf(a), mood: moodOf(side), name: nm } : null);
  // After a full division the pot's size is 0: show the pot it was.
  const initialStr = (d as { initialNotional?: string }).initialNotional;
  const initial = initialStr && initialStr !== "0" ? BigInt(initialStr) : null;
  const notional = d.notional !== "0" ? BigInt(d.notional) : (initial ?? BigInt(d.depYes) + BigInt(d.depNo));
  const start = Number(d.requestTime) + 1;
  const win = { start, end: start + Number(d.window), now: nowS };
  const lastDivision = pot.requests.find((r) => r.kind === "window" && r.payload.kind === 1 && r.status === "submitted" && r.payload.attestation?.valid);
  const stamp = lastDivision?.payload.attestation ? `Exit at ${(lastDivision.payload.attestation.priceYes / 10_000).toFixed(1)}%` : null;
  const startedAt = initial && initial !== notional ? initial : null;
  const cats = { yes: cat(owners.yes, 0, names.yes), no: cat(owners.no, 1, names.no) };
  const sides = pot.market ? sidesOf(pot.market) : undefined;

  switch (pot.state) {
    case "Open":
      return { price, notional, names, phase: "waiting", levels, startedAt, cats, sides };
    case "Joining":
      return { price, notional, names, phase: "joining", levels, window: { label: "Entry price", ...win }, startedAt, cats, sides };
    case "Live":
      return { price, notional, names, phase: "live", levels, stamp: null, startedAt, cats, sides };
    case "ExitRequested": {
      const partial = d.exitNotional !== d.notional;
      const who = Number(d.exitSide) === 0 ? names.yes : names.no;
      return {
        price,
        notional,
        names,
        phase: "exit",
        levels,
        startedAt,
        cats,
        sides,
        window: { label: partial ? `${who} is leaving with $${(Number(d.exitNotional) / 1e6).toFixed(2)} of the pot (a partial exit). Exit price` : `${who} is leaving. Exit price`, ...win },
      };
    }
    case "Divided":
      return { price: lastDivision?.payload.attestation ? lastDivision.payload.attestation.priceYes / 1e6 : price, notional, names, phase: "divided", stamp, cats, sides };
    case "Settled": {
      const o2 = pot.requests.find((r) => r.kind === "outcome")?.payload as { attestation?: { outcome: number } } | undefined;
      const outcome = o2?.attestation?.outcome;
      return { price, notional, names, phase: "settled", receiver: outcome === 1 ? 0 : outcome === 0 ? 1 : 2, cats, sides };
    }
    default:
      return { price, notional, names, phase: "expired", cats, sides };
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

const usd = (base: string | number | bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;

/**
 * The pot's story in plain words, from its own events: who did what, at which price, what each side
 * received, and what remained. Explains why a pot can still be live after an exit price was measured
 * (a partial exit, a takeover, or an exit that could not be priced).
 */
export function storyOf(pot: HcPot, name: (a: string | null) => string): { at: number | null; text: string; tx: string }[] {
  const out: { at: number | null; text: string; tx: string }[] = [];
  const st = pot.market ? sidesOf(pot.market) : null;
  // A side by what it stands for ("the “Cleveland beats Chicago” side"); YES and NO without a market.
  const sideName = (s: string | number) => (st ? `the “${Number(s) === 0 ? st.yes : st.no}” side` : Number(s) === 0 ? "YES" : "NO");
  const Side = (s: string | number) => sideName(s).replace(/^the/, "The");
  const pc = (ppm: string | number) => `${(Number(ppm) / 10_000).toFixed(1)}%`;
  let size = 0n;
  let pendingExit: string | null = null;
  for (const e of pot.events ?? []) {
    const g = e.args;
    switch (e.name) {
      case "PotCreated":
        size = BigInt(g.notional ?? "0");
        out.push({ at: e.at, tx: e.tx, text: `${name(g.creator ?? null)} opened a ${usd(size)} pot on ${sideName(g.side ?? 0)} and put in up to ${usd(g.escrow ?? 0)}.` });
        break;
      case "JoinRequested":
        out.push({ at: e.at, tx: e.tx, text: `${name(g.joiner ?? null)} asked to take the other side; the entry price was measured over the next 30 seconds.` });
        break;
      case "Joined":
        out.push({ at: e.at, tx: e.tx, text: `Joined at ${pc(g.entryPrice ?? 0)} chance: ${sideName(0)} put in ${usd(g.depYes ?? 0)}, ${sideName(1)} ${usd(g.depNo ?? 0)}. Anything put in above that came straight back.` });
        break;
      case "JoinFailed":
        out.push({ at: e.at, tx: e.tx, text: "The entry price could not be agreed (or left the band), so the join did not happen and the joiner got everything back." });
        break;
      case "ExitRequested": {
        const n = BigInt(g.notional ?? "0");
        pendingExit = Side(g.side ?? 0);
        out.push({
          at: e.at,
          tx: e.tx,
          text: n < size ? `${pendingExit} asked to leave with ${usd(n)} of the ${usd(size)} pot (a partial exit).` : `${pendingExit} asked to leave with the whole pot.`,
        });
        break;
      }
      case "TakeoverOffered":
        out.push({ at: e.at, tx: e.tx, text: `${name(g.taker ?? null)} offered to take over the leaving side, putting in ${usd(size)}.` });
        break;
      case "TakenOver":
        out.push({
          at: e.at,
          tx: e.tx,
          text: `Taken over at ${pc(g.price ?? 0)}: ${name(g.to ?? null)} now holds ${sideName(g.side ?? 0)} and paid ${name(g.from ?? null)} ${usd(g.paidExiter ?? 0)} for it (after a ${usd(g.fee ?? 0)} fee to the other side). The pot did not divide: it continues at ${usd(size)} with the new holder.`,
        });
        pendingExit = null;
        break;
      case "PotDivided": {
        const n = BigInt(g.notional ?? "0");
        const partial = n < size;
        size -= n;
        out.push({
          at: e.at,
          tx: e.tx,
          text: partial
            ? `Partial exit at ${pc(g.price ?? 0)}: ${usd(n)} of the pot was divided (${sideName(0)} got ${usd(g.paidYes ?? 0)}, ${sideName(1)} ${usd(g.paidNo ?? 0)}, fee ${usd(g.fee ?? 0)}). The pot continues with ${usd(size)}.`
            : `Divided at ${pc(g.price ?? 0)}: ${sideName(0)} got ${usd(g.paidYes ?? 0)}, ${sideName(1)} ${usd(g.paidNo ?? 0)} (including the ${usd(g.fee ?? 0)} fee to the side that stayed).`,
        });
        pendingExit = null;
        break;
      }
      case "ExitFailed":
        out.push({ at: e.at, tx: e.tx, text: `${pendingExit ? `${pendingExit}'s exit` : "The exit"} could not be priced (the samplers did not agree), so nothing moved and the pot continues; a new exit can be asked after two minutes.` });
        pendingExit = null;
        break;
      case "Handshake":
        size -= BigInt(g.notional ?? "0");
        out.push({ at: e.at, tx: e.tx, text: `Both sides shook hands at ${pc(g.price ?? 0)} and divided ${usd(g.notional ?? 0)} with no fee.${size > 0n ? ` The pot continues with ${usd(size)}.` : ""}` });
        break;
      case "LevelsSet":
        out.push({ at: e.at, tx: e.tx, text: `${Side(g.side ?? 0)} set ${Number(g.net) ? `a net at ${pc(g.net ?? 0)}` : "no net"} and ${Number(g.bowl) ? `a bowl at ${pc(g.bowl ?? 0)}` : "no bowl"}.` });
        break;
      case "LevelTriggered":
        out.push({ at: e.at, tx: e.tx, text: `${Side(g.side ?? 0)}'s ${Number(g.kind) >= 4 ? "bowl" : "net"} held for a full window at ${pc(g.priceYes ?? 0)}, so its exit was filed.` });
        break;
      case "PotSettled": {
        const o = Number(g.outcome);
        out.push({
          at: e.at,
          tx: e.tx,
          text: o === 2 ? "Gemini voided the market: both deposits went back." : `Gemini's result: ${st ? (o === 1 ? st.yes : st.no) : o === 1 ? "YES" : "NO"}. ${Side(0)} got ${usd(g.paidYes ?? 0)}, ${sideName(1)} ${usd(g.paidNo ?? 0)}.`,
        });
        break;
      }
      case "PotExpired":
        out.push({ at: e.at, tx: e.tx, text: `Closed without a result: ${sideName(0)} got ${usd(g.paidYes ?? 0)} back, ${sideName(1)} ${usd(g.paidNo ?? 0)}.` });
        break;
    }
  }
  return out;
}
