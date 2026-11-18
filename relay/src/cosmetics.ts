/**
 * Rewards without money (spec section 11): cat cosmetics unlocked by honor record milestones, shown
 * on the player's cat everywhere, with the next unlock visible. Facts only from contract events
 * (pot_events), practice pots and Grok Bot seats excluded, one query for many accounts.
 */
import type { Db } from "./db";

export type Cosmetic = "bell" | "scarf" | "bow" | "hat" | "crown";
export type Progress = { pots: number; heldToEnd: number; handshakes: number; treats: number; followers: number };

/** In unlock order; a cat wears its newest unlock. */
export const MILESTONES: { wear: Cosmetic; label: string; need: string; done: (p: Progress) => boolean; left: (p: Progress) => string }[] = [
  { wear: "bell", label: "Bell collar", need: "play your first pot", done: (p) => p.pots >= 1, left: () => "play one pot" },
  { wear: "scarf", label: "Green scarf", need: "play 5 pots", done: (p) => p.pots >= 5, left: (p) => `${5 - p.pots} more pot${5 - p.pots === 1 ? "" : "s"}` },
  { wear: "bow", label: "Blue bow tie", need: "shake hands once, or earn a treat", done: (p) => p.handshakes >= 1 || p.treats >= 1, left: () => "one handshake or one treat" },
  { wear: "hat", label: "Captain's hat", need: "hold 3 pots to the end", done: (p) => p.heldToEnd >= 3, left: (p) => `${3 - p.heldToEnd} more held to the end` },
  { wear: "crown", label: "Golden crown", need: "play 25 pots, or be copied by another player", done: (p) => p.pots >= 25 || p.followers >= 1, left: (p) => `${25 - p.pots} more pots, or one copycat` },
];

export function cosmeticsOf(p: Progress) {
  const unlocked = MILESTONES.filter((m) => m.done(p));
  const next = MILESTONES.find((m) => !m.done(p)) ?? null;
  return {
    wear: unlocked.at(-1)?.wear ?? null,
    unlocked: unlocked.map((m) => ({ wear: m.wear, label: m.label })),
    next: next ? { wear: next.wear, label: next.label, need: next.need, left: next.left(p) } : null,
    progress: p,
  };
}

const NOT_PRACTICE = `e.pot_id IS NULL OR (NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = e.pot_id) AND NOT EXISTS (SELECT 1 FROM seat_pots sp WHERE sp.pot_id = e.pot_id))`;

/** Progress towards the milestones for up to 50 accounts (lower-case keys). */
export async function progressOf(db: Db, accounts: string[]): Promise<Record<string, Progress>> {
  const list = [...new Set(accounts.map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))].slice(0, 50);
  const out: Record<string, Progress> = {};
  for (const a of list) out[a] = { pots: 0, heldToEnd: 0, handshakes: 0, treats: 0, followers: 0 };
  if (!list.length) return out;
  const rows = await db.query<{ account: string; pots: string; held: string; hands: string; treats: string; followers: string }>(
    `WITH mine AS (
       SELECT DISTINCT lower(e.args->>'to') AS account, e.pot_id FROM pot_events e
        WHERE e.event_name = 'Transfer' AND lower(e.args->>'to') = ANY($1::text[]) AND (${NOT_PRACTICE})
     )
     SELECT a.account,
       (SELECT count(*) FROM mine m WHERE m.account = a.account)::text AS pots,
       (SELECT count(*) FROM mine m JOIN pot_events s ON s.pot_id = m.pot_id AND s.event_name = 'PotSettled' WHERE m.account = a.account)::text AS held,
       (SELECT count(*) FROM mine m JOIN pot_events h ON h.pot_id = m.pot_id AND h.event_name = 'Handshake' WHERE m.account = a.account)::text AS hands,
       (SELECT count(*) FROM pot_events t WHERE t.event_name IN ('MakerTreat','ExitFee','ReferralTreat','CopycatTreat')
          AND lower(coalesce(t.args->>'to', t.args->>'referrer', t.args->>'leader')) = a.account)::text AS treats,
       (SELECT count(*) FROM pot_events c WHERE c.event_name = 'CopyMarked' AND lower(c.args->>'leader') = a.account)::text AS followers
     FROM unnest($1::text[]) AS a(account)`,
    [list],
  );
  for (const r of rows) out[r.account] = { pots: Number(r.pots), heldToEnd: Number(r.held), handshakes: Number(r.hands), treats: Number(r.treats), followers: Number(r.followers) };
  return out;
}
