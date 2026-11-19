import { describe, expect, it } from "vitest";
import { HONOR_V1, titleOf, honorCosmetics } from "../src/honor/config";
import { computeHonor, type HonorEvent, type HonorInput } from "../src/honor/compute";

const ZERO = `0x${"0".repeat(40)}`;
const acct = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const AFTER = HONOR_V1.trustOpenUntil + 86_400 * 10; // well after the founding period
const BEFORE = HONOR_V1.trustOpenUntil - 86_400 * 10;

/** Builds the events of one two-player pot: created, both sides minted, joined, then an ending. */
function pot(o: {
  id: number;
  a: string;
  b: string;
  t0: number;
  hours: number;
  stake?: number;
  v2?: boolean;
  end: "settled" | "exitA" | "handshake" | "expiry";
}): HonorEvent[] {
  const pid = String(o.id);
  const stake = o.stake ?? 1_000_000;
  let blk = o.id * 100;
  const ev = (name: string, at: number, args: Record<string, unknown>): HonorEvent => ({ block: blk++, log: 0, at, name, potId: pid, args });
  const size = o.v2 ? { size: "10" } : { notional: String(2 * stake) };
  const out: HonorEvent[] = [
    ev("PotCreated", o.t0, { creator: o.a, side: 0, ...size }),
    ev("Transfer", o.t0, { from: ZERO, to: o.a, tokenId: String(o.id * 2) }),
    ev("Transfer", o.t0 + 60, { from: ZERO, to: o.b, tokenId: String(o.id * 2 + 1) }),
    ev("Joined", o.t0 + 90, { depYes: String(stake), depNo: String(stake) }),
  ];
  const end = o.t0 + 90 + o.hours * 3600;
  if (o.end === "settled") out.push(ev("PotSettled", end, { outcome: 1, paidYes: "0", paidNo: "0" }));
  if (o.end === "exitA") {
    out.push(ev("ExitRequested", end - 40, { side: 0 }));
    out.push(ev("PotDivided", end, o.v2 ? { reason: 0, size: "10" } : { exitSide: 0, notional: String(2 * stake) }));
  }
  if (o.end === "handshake") {
    out.push(ev("Handshake", end, {}));
    out.push(ev("PotDivided", end, o.v2 ? { reason: 3, size: "10" } : { exitSide: 0, notional: String(2 * stake) }));
  }
  if (o.end === "expiry") out.push(ev("PotDivided", end, { reason: 2, size: "10" }));
  return out;
}

const base = (events: HonorEvent[], extra: Partial<HonorInput> = {}): HonorInput => ({
  events,
  notes: [],
  practice: new Set(),
  seats: new Set(),
  funding: {},
  sharedFunders: new Set(),
  clusters: [],
  notPlayers: new Set(),
  cutoff: AFTER + 86_400 * 400,
  ...extra,
});
const bal = (r: ReturnType<typeof computeHonor>, a: string) => (r.balances[a] ?? 0) / 100;

describe("honor", () => {
  it("is deterministic: the same events in any order give the same history and balances", () => {
    const evs = [
      ...pot({ id: 1, a: acct(1), b: acct(2), t0: BEFORE, hours: 3, end: "settled" }),
      ...pot({ id: 2, a: acct(2), b: acct(3), t0: BEFORE + 9000, hours: 20, end: "handshake", v2: true }),
    ];
    const one = computeHonor(base(evs), HONOR_V1);
    const two = computeHonor(base([...evs].reverse()), HONOR_V1);
    expect(two.balances).toEqual(one.balances);
    expect(two.entries).toEqual(one.entries);
  });

  it("rewards conduct: holding (2 an hour, at most 20), a handshake, a joined offer; leaving earns nothing", () => {
    const r = computeHonor(base(pot({ id: 1, a: acct(1), b: acct(2), t0: BEFORE, hours: 3, end: "exitA" })), HONOR_V1);
    // A left: only the join of A's open side counts for A; B held 3 h = 6 (both untrusted: half)
    expect(bal(r, acct(1))).toBeCloseTo(5 * 0.5, 2);
    expect(bal(r, acct(2))).toBeCloseTo(6 * 0.5, 2);
    const long = computeHonor(base(pot({ id: 2, a: acct(1), b: acct(2), t0: BEFORE, hours: 30, end: "handshake", v2: true })), HONOR_V1);
    // A: joined 5 + handshake 10 + held 20 (cap), all at half
    expect(bal(long, acct(1))).toBeCloseTo((5 + 10 + 20) * 0.5, 2);
  });

  it("covers v1 and v2 pots retroactively, and perps", () => {
    const perp: HonorEvent[] = [
      { block: 9000, log: 0, at: BEFORE, name: "Perp:PerpOpened", potId: null, args: { perpId: "7", creator: acct(5), side: 0, budget: "500000" } },
      { block: 9001, log: 0, at: BEFORE + 60, name: "Perp:PerpJoined", potId: null, args: { perpId: "7", joiner: acct(6), budget: "500000" } },
      { block: 9002, log: 0, at: BEFORE + 120, name: "Perp:RopeStarted", potId: "2000000001", args: { perpId: "7", rope: 1 } },
      { block: 9003, log: 0, at: BEFORE + 120 + 4 * 3600, name: "Perp:PerpEnded", potId: null, args: { perpId: "7", why: "renewal switched off" } },
    ];
    const r = computeHonor(
      base([...pot({ id: 1, a: acct(1), b: acct(2), t0: BEFORE, hours: 2, end: "settled" }), ...pot({ id: 2000000002, a: acct(3), b: acct(4), t0: BEFORE, hours: 2, end: "expiry", v2: true }), ...perp]),
      HONOR_V1,
    );
    for (const a of [1, 2, 3, 4, 5, 6]) expect(bal(r, acct(a))).toBeGreaterThan(0);
    expect(r.entries.find((e) => e.potId === "-7" && e.action === "held")).toBeTruthy();
  });

  it("gives nothing for practice pots, tiny stakes, or pots ending within 10 minutes", () => {
    const evs = [
      ...pot({ id: 1, a: acct(1), b: acct(2), t0: BEFORE, hours: 5, end: "settled" }),
      ...pot({ id: 2, a: acct(3), b: acct(4), t0: BEFORE, hours: 5, end: "settled", stake: 50_000 }),
      ...pot({ id: 3, a: acct(5), b: acct(6), t0: BEFORE, hours: 0.1, end: "settled" }),
    ];
    const r = computeHonor(base(evs, { practice: new Set(["1"]) }), HONOR_V1);
    for (const a of [1, 2, 3, 4, 5, 6]) expect(r.entries.filter((e) => e.account === acct(a) && e.action !== "streak").length).toBe(0);
  });

  it("two linked accounts trading handshakes earn little: halving per repeat in 24 h, and nothing once flagged or same-funded", () => {
    const evs: HonorEvent[] = [];
    for (let i = 0; i < 10; i++) evs.push(...pot({ id: 10 + i, a: acct(1), b: acct(2), t0: AFTER + i * 3600, hours: 0.5, end: "handshake" }));
    const r = computeHonor(base(evs), HONOR_V1);
    // untrusted (half), and halved each repeat: handshakes total under 2 × the first one
    const hs = r.entries.filter((e) => e.account === acct(1) && e.action === "handshake");
    expect(hs.length).toBe(10);
    const total = hs.reduce((t, e) => t + e.points, 0) / 100;
    expect(total).toBeLessThanOrEqual(2 * HONOR_V1.handshake * HONOR_V1.untrustedFactor);
    expect(hs[9]!.points).toBeLessThan(5); // under 0.05 points by the tenth
    const funded = computeHonor(base(evs, { funding: { [acct(1)]: acct(99), [acct(2)]: acct(99) } }), HONOR_V1);
    expect(bal(funded, acct(1))).toBe(0);
    expect(funded.entries.every((e) => e.removed === "both accounts were funded from the same source")).toBe(true);
    const shared = computeHonor(base(evs, { funding: { [acct(1)]: acct(99), [acct(2)]: acct(99) }, sharedFunders: new Set([acct(99)]) }), HONOR_V1);
    expect(bal(shared, acct(1))).toBeGreaterThan(0);
    const flagged = computeHonor(base(evs, { clusters: [{ accounts: [acct(1), acct(2)], reason: "flagged: repeated pots with each other", since: 0 }] }), HONOR_V1);
    expect(bal(flagged, acct(1))).toBe(0);
    expect(flagged.entries[0]!.removed).toBe("flagged: repeated pots with each other");
  });

  it("a closed circle of new accounts stays at half honor; playing trusted players lifts it", () => {
    const circle = [11, 12, 13, 14].map(acct);
    const evs: HonorEvent[] = [];
    let id = 100;
    for (let round = 0; round < 3; round++)
      for (let i = 0; i < circle.length; i++)
        for (let j = i + 1; j < circle.length; j++) evs.push(...pot({ id: id++, a: circle[i]!, b: circle[j]!, t0: AFTER + id * 4000, hours: 1, end: "settled" }));
    const r = computeHonor(base(evs), HONOR_V1);
    expect(r.trusted.filter((a) => circle.includes(a))).toEqual([]);
    expect(r.entries.filter((e) => circle.includes(e.account) && !e.removed).every((e) => e.notes.some((n) => n.startsWith("half")))).toBe(true);
    // founding players (before the opening date) vouch for each other with 3 counterparties
    const founders = [21, 22, 23, 24].map(acct);
    const f: HonorEvent[] = [];
    let k = 500;
    for (let i = 0; i < founders.length; i++)
      for (let j = i + 1; j < founders.length; j++) f.push(...pot({ id: k++, a: founders[i]!, b: founders[j]!, t0: BEFORE + (k - 500) * 4000, hours: 1, end: "settled" }));
    const r2 = computeHonor(base(f), HONOR_V1);
    expect(r2.trusted).toEqual([...founders].sort());
  });

  it("titles and cosmetics follow honor thresholds", () => {
    expect(titleOf(0)).toBe("Stray");
    expect(titleOf(20)).toBe("House Cat");
    expect(titleOf(150)).toBe("Honor Cat");
    expect(titleOf(400)).toBe("Lion");
    expect(honorCosmetics(0).wear).toBeNull();
    expect(honorCosmetics(60).wear).toBe("bow");
    expect(honorCosmetics(60).next).toMatchObject({ wear: "hat", min: 100, left: "40 honor" });
  });
});
