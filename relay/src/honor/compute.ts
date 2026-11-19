import type { HonorConfig } from "./config";

/**
 * Honor, computed from scratch by replaying the contracts' events (v1 pots, v2 pots, perps) and the
 * signed "Well played" notes, in a fixed order. Pure: the same input and config always give the same
 * history and balances (docs/honor.md has the rules in words).
 *
 * Honor rewards conduct, never results: winning, stake size, leverage and volume earn nothing.
 * Leaving is a right: it earns nothing and costs nothing.
 */

export type HonorEvent = { block: number; log: number; at: number; name: string; potId: string | null; args: Record<string, unknown> };
export type HonorNote = { potId: string; account: string; at: number };
export type Cluster = { accounts: string[]; reason: string; since: number };

export type HonorInput = {
  events: HonorEvent[];
  notes: HonorNote[];
  /** practice pots (database ids) and practice perps (as "-perpId") */
  practice: Set<string>;
  /** Grok Bot (agent) seat pots */
  seats: Set<string>;
  /** account -> the address that first funded it (from the daily check); lower case */
  funding: Record<string, string>;
  /** funders shared by many unrelated players (HonorCat's welcome money, faucets): never a link */
  sharedFunders: Set<string>;
  /** accounts flagged together by the daily farming check */
  clusters: Cluster[];
  /** contracts that hold sides (the perps contract): not players */
  notPlayers: Set<string>;
  /** the time honor is counted up to (unix s): pending awards of live pots older than the minimum count */
  cutoff: number;
};

export type HonorAction = "held" | "handshake" | "joined" | "takeover" | "goodGame" | "referral" | "streak" | "smallerTeam";

export type HonorEntry = {
  seq: number;
  account: string;
  at: number;
  action: HonorAction;
  /** pot id, or "-perpId" for a perp, or null */
  potId: string | null;
  counterparty: string | null;
  /** points before reductions and after, in hundredths */
  base: number;
  points: number;
  /** reductions, in words ("half: not yet trusted") */
  notes: string[];
  /** removed by an anti-farming rule, with the reason (points then 0) */
  removed: string | null;
};

const ZERO = /^0x0{40}$/i;
const lc = (v: unknown) => String(v ?? "").toLowerCase();
const num = (v: unknown) => Number(v ?? 0);

type Pending = { account: string; counterparty: string | null; action: HonorAction; base: number; at: number; extra?: string[] };
type PotState = {
  creator: string | null;
  creatorSide: number;
  remaining: number;
  startedAt: number | null;
  stake: [number, number];
  ended: boolean;
  pending: Pending[];
};
type PerpState = { a: string; b: string | null; side: number; budgetA: number; budgetB: number; startedAt: number | null; leaver: string | null; pending: Pending[]; ended: boolean };

export function computeHonor(input: HonorInput, cfg: HonorConfig) {
  const entries: HonorEntry[] = [];
  const balance = new Map<string, number>();
  const owner = new Map<string, string>(); // `${pot}:${side}` -> account
  const since = new Map<string, number>(); // `${pot}:${side}` -> when the current owner got it
  const pots = new Map<string, PotState>();
  const perps = new Map<string, PerpState>();
  const completedWith = new Map<string, Set<string>>();
  const pairTimes = new Map<string, { pot: string | null; at: number }[]>();
  const referrerOf = new Map<string, string>();
  const referralPaid = new Set<string>();
  const streak = new Map<string, { day: number; run: number }>();
  const goodGame = new Set<string>();
  // v2 exits name their side in ExitRequested; kept per pot while replaying
  const lastExitSide = new Map<string, number>();

  const trusted = (a: string) => (completedWith.get(a)?.size ?? 0) >= cfg.trustCounterparties;
  const clusterOf = (a: string, b: string, at: number) => input.clusters.find((c) => at >= c.since && c.accounts.includes(a) && c.accounts.includes(b)) ?? null;
  const excluded = (potKey: string | null) => !!potKey && (input.practice.has(potKey) || input.seats.has(potKey));

  function award(p: Pending, potId: string | null) {
    const a = p.account;
    if (!a || ZERO.test(a) || input.notPlayers.has(a)) return;
    const cp = p.counterparty && !input.notPlayers.has(p.counterparty) ? p.counterparty : null;
    const notes = [...(p.extra ?? [])];
    let removed: string | null = null;
    let points = p.base;
    if (cp) {
      const fa = input.funding[a];
      const fb = input.funding[cp];
      if (fa && fb && fa === fb && !input.sharedFunders.has(fa)) removed = "both accounts were funded from the same source";
      const cl = clusterOf(a, cp, p.at);
      if (!removed && cl) removed = cl.reason;
      // Repeated play with the same player: the first pot in 24 hours counts in full, each further pot
      // with them in that window halves again (the join, handshake and hold of one pot are one action).
      const key = `${a}|${cp}`;
      const seen = (pairTimes.get(key) ?? []).filter((x) => p.at - x.at < cfg.sameCounterpartyWindowS);
      const earlier = new Set(seen.filter((x) => x.pot !== potId).map((x) => x.pot)).size;
      if (earlier) {
        points = points / 2 ** earlier;
        notes.push(`halved ${earlier === 1 ? "once" : `${earlier} times`}: pot ${earlier + 1} with the same player within 24 hours`);
      }
      if (!seen.some((x) => x.pot === potId)) seen.push({ pot: potId, at: p.at });
      pairTimes.set(key, seen);
    }
    if (!trusted(a) && !removed) {
      points *= cfg.untrustedFactor;
      notes.push(`half: not yet trusted (needs pots with ${cfg.trustCounterparties} different trusted players)`);
    }
    const final = removed ? 0 : Math.round(points * 100) / 100;
    entries.push({ seq: entries.length + 1, account: a, at: p.at, action: p.action, potId, counterparty: cp, base: Math.round(p.base * 100), points: Math.round(final * 100), notes, removed });
    if (!removed) balance.set(a, (balance.get(a) ?? 0) + Math.round(final * 100));
    // A referred friend's first pot that counts: the referrer's treat of honor.
    if (!removed && p.action === "held" && !referralPaid.has(a) && referrerOf.has(a)) {
      referralPaid.add(a);
      award({ account: referrerOf.get(a)!, counterparty: a, action: "referral", base: cfg.referral, at: p.at }, potId);
    }
  }

  function noteTrust(a: string | null, b: string | null, at: number) {
    if (!a || !b || a === b || input.notPlayers.has(a) || input.notPlayers.has(b)) return;
    // Before the opening date any counterparty counts (the founding players); after it only trusted ones,
    // so a closed circle of new accounts cannot vouch for itself.
    if (at < cfg.trustOpenUntil || trusted(b)) (completedWith.get(a) ?? completedWith.set(a, new Set()).get(a)!).add(b);
  }

  function playDay(a: string, at: number) {
    if (!a || ZERO.test(a) || input.notPlayers.has(a)) return;
    const day = Math.floor(at / 86_400);
    const s = streak.get(a);
    if (s && s.day === day) return;
    const run = s && s.day === day - 1 ? s.run + 1 : 1;
    streak.set(a, { day, run });
    if (run >= 2 && run - 1 <= cfg.streakMaxDays) award({ account: a, counterparty: null, action: "streak", base: cfg.streakDay, at, extra: [`day ${run} in a row`] }, null);
  }

  const stakeOk = (s: PotState, side: number) => s.stake[side]! >= cfg.minStake;

  function endPot(potId: string, s: PotState, at: number, leaverSide: number | null) {
    if (s.ended) return;
    s.ended = true;
    if (excluded(potId) || s.startedAt === null) return;
    if (at - s.startedAt < cfg.minDurationS) return; // ended too soon after it started: nothing counts
    for (const p of s.pending.sort((x, y) => x.at - y.at)) award(p, potId);
    s.pending = [];
    const yes = owner.get(`${potId}:0`) ?? null;
    const no = owner.get(`${potId}:1`) ?? null;
    for (const side of [0, 1]) {
      if (side === leaverSide) continue; // leaving earns nothing (and costs nothing)
      const a = side === 0 ? yes : no;
      if (!a || !stakeOk(s, side)) continue;
      const from = Math.max(s.startedAt, since.get(`${potId}:${side}`) ?? s.startedAt);
      const hours = Math.max(0, at - from) / 3600;
      const base = Math.min(cfg.holdMaxPerPot, hours * cfg.holdPerHour);
      if (base > 0) award({ account: a, counterparty: side === 0 ? no : yes, action: "held", base, at, extra: [`held ${hours.toFixed(1)} h`] }, potId);
    }
    noteTrust(yes, no, at);
    noteTrust(no, yes, at);
  }

  type Item = { at: number; k: number; block: number; log: number; ev?: HonorEvent; note?: HonorNote };
  const items: Item[] = [
    ...input.events.map((ev): Item => ({ at: ev.at, k: 0, block: ev.block, log: ev.log, ev })),
    ...input.notes.map((note): Item => ({ at: note.at, k: 1, block: 0, log: 0, note })),
  ].sort((x, y) => x.at - y.at || x.k - y.k || x.block - y.block || x.log - y.log || (x.note && y.note ? (x.note.account < y.note.account ? -1 : 1) : 0));

  for (const it of items) {
    if (it.note) {
      const n = it.note;
      const s = pots.get(n.potId);
      const key = `${n.potId}:${n.account}`;
      if (!s || !s.ended || goodGame.has(key) || excluded(n.potId)) continue;
      const yes = owner.get(`${n.potId}:0`);
      const no = owner.get(`${n.potId}:1`);
      const side = n.account === yes ? 0 : n.account === no ? 1 : -1;
      if (side < 0 || !stakeOk(s, side)) continue;
      goodGame.add(key);
      award({ account: n.account, counterparty: side === 0 ? (no ?? null) : (yes ?? null), action: "goodGame", base: cfg.goodGame, at: n.at }, n.potId);
      continue;
    }
    const ev = it.ev!;
    const g = ev.args;
    const potId = ev.potId;
    const s = potId ? pots.get(potId) : undefined;
    switch (ev.name) {
      case "PotCreated":
        if (potId) pots.set(potId, { creator: lc(g.creator), creatorSide: num(g.side), remaining: num(g.notional ?? g.size), startedAt: null, stake: [0, 0], ended: false, pending: [] });
        break;
      case "Transfer": {
        if (!potId) break;
        const side = Number(BigInt(String(g.tokenId ?? 0)) % 2n);
        owner.set(`${potId}:${side}`, lc(g.to));
        since.set(`${potId}:${side}`, ev.at);
        if (ZERO.test(String(g.from)) && !excluded(potId)) playDay(lc(g.to), ev.at);
        break;
      }
      case "Joined":
        if (!s) break;
        s.startedAt = ev.at;
        s.stake = [num(g.depYes), num(g.depNo)];
        if (s.creator && !excluded(potId) && stakeOk(s, s.creatorSide)) {
          const joiner = owner.get(`${potId}:${1 - s.creatorSide}`) ?? null;
          s.pending.push({ account: s.creator, counterparty: joiner, action: "joined", base: cfg.openJoined, at: ev.at });
        }
        break;
      case "Handshake":
        if (!s || excluded(potId)) break;
        for (const side of [0, 1]) {
          const a = owner.get(`${potId}:${side}`);
          if (a && stakeOk(s, side)) s.pending.push({ account: a, counterparty: owner.get(`${potId}:${1 - side}`) ?? null, action: "handshake", base: cfg.handshake, at: ev.at });
        }
        break;
      case "TakenOver":
        if (!s || excluded(potId)) break;
        s.pending.push({ account: lc(g.to), counterparty: owner.get(`${potId}:${1 - num(g.side)}`) ?? null, action: "takeover", base: cfg.takeover, at: ev.at });
        break;
      case "PotDivided": {
        if (!s || !potId) break;
        const size = num(g.notional ?? g.size);
        s.remaining -= size;
        if (s.remaining > 0) break; // a partial exit: the pot continues
        // v1 names the side that left; v2 gives a reason (0 exit, 1 knock-out, 2 expiry, 3 handshake)
        const reason = g.reason === undefined ? 0 : num(g.reason);
        const leaver = reason === 0 && g.exitSide !== undefined ? num(g.exitSide) : reason === 0 ? exitSideOf(potId) : null;
        endPot(potId, s, ev.at, reason === 0 ? leaver : null);
        break;
      }
      case "ExitRequested":
        if (potId) lastExitSide.set(potId, num(g.side));
        break;
      case "PotSettled":
      case "PotExpired":
        if (s && potId) endPot(potId, s, ev.at, null);
        break;
      case "ReferrerSet":
        if (!referrerOf.has(lc(g.account))) referrerOf.set(lc(g.account), lc(g.referrer));
        break;
      case "Perp:PerpOpened": {
        const id = String(g.perpId);
        perps.set(id, { a: lc(g.creator), b: null, side: num(g.side), budgetA: num(g.budget), budgetB: 0, startedAt: null, leaver: null, pending: [], ended: false });
        if (!input.practice.has(`-${id}`)) playDay(lc(g.creator), ev.at);
        break;
      }
      case "Perp:PerpJoined": {
        const q = perps.get(String(g.perpId));
        if (!q) break;
        q.b = lc(g.joiner);
        q.budgetB = num(g.budget);
        if (!input.practice.has(`-${g.perpId}`)) {
          playDay(q.b, ev.at);
          if (q.budgetA >= cfg.minStake) q.pending.push({ account: q.a, counterparty: q.b, action: "joined", base: cfg.openJoined, at: ev.at });
        }
        break;
      }
      case "Perp:RopeStarted": {
        const q = perps.get(String(g.perpId));
        if (q && q.startedAt === null) q.startedAt = ev.at;
        break;
      }
      case "Perp:LeaveRequested": {
        const q = perps.get(String(g.perpId));
        if (q && !q.leaver) q.leaver = lc(g.player);
        break;
      }
      case "Perp:PerpEnded": {
        const id = String(g.perpId);
        const q = perps.get(id);
        if (!q || q.ended) break;
        q.ended = true;
        const key = `-${id}`;
        if (input.practice.has(key) || q.startedAt === null || !q.b || ev.at - q.startedAt < cfg.minDurationS) break;
        for (const p of q.pending.sort((x, y) => x.at - y.at)) award(p, key);
        q.pending = [];
        const hours = (ev.at - q.startedAt) / 3600;
        const base = Math.min(cfg.holdMaxPerPot, hours * cfg.holdPerHour);
        for (const [a, cp, budget] of [[q.a, q.b, q.budgetA], [q.b, q.a, q.budgetB]] as const) {
          if (a === q.leaver || budget < cfg.minStake || base <= 0) continue;
          award({ account: a, counterparty: cp, action: "held", base, at: ev.at, extra: [`held the perp ${hours.toFixed(1)} h`] }, key);
        }
        noteTrust(q.a, q.b, ev.at);
        noteTrust(q.b, q.a, ev.at);
        break;
      }
    }
  }

  // Live pots and perps old enough: what they earned so far counts (joins, handshakes, takeovers).
  for (const [potId, s] of [...pots].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (s.ended || s.startedAt === null || excluded(potId) || input.cutoff - s.startedAt < cfg.minDurationS) continue;
    for (const p of s.pending.sort((x, y) => x.at - y.at)) award(p, potId);
    s.pending = [];
  }
  for (const [id, q] of [...perps].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (q.ended || q.startedAt === null || input.practice.has(`-${id}`) || input.cutoff - q.startedAt < cfg.minDurationS) continue;
    for (const p of q.pending.sort((x, y) => x.at - y.at)) award(p, `-${id}`);
    q.pending = [];
  }

  return {
    version: cfg.version,
    entries,
    balances: Object.fromEntries([...balance].sort((x, y) => (x[0] < y[0] ? -1 : 1))) as Record<string, number>,
    trusted: [...completedWith].filter(([, v]) => v.size >= cfg.trustCounterparties).map(([k]) => k).sort(),
  };

  function exitSideOf(potId: string) {
    return lastExitSide.get(potId) ?? null;
  }
}
