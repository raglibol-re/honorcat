import { getAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";

/**
 * Posts: short public notes by players, optionally about one of their own pots, perps or groups
 * ("Took UCF at 51%, the line looks cheap"). A post is signed by its author (wallet signature or
 * one passkey confirmation), moves no money and authorises nothing. A post about a play is checked
 * against the read model: the author must hold a side in it, and private pots cannot be posted
 * about. What the post shows about the play (side, price, state) is a snapshot at posting time.
 * Behind SOCIAL=on.
 */
export const socialOn = () => (process.env.SOCIAL ?? "").toLowerCase() === "on";

export const POST_MAX = 280;
export const POSTS_PER_HOUR = 10;

export type About = { kind: "pot" | "perp" | "group"; id: string };

/** The text as stored and signed: no control characters, at most two blank lines, trimmed. */
export function cleanBody(body: string) {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const postMessage = (account: string, body: string, about: About | null, issuedAt: string) =>
  `HonorCat: post${about ? ` about ${about.kind} ${about.id}` : ""}:\n${body}\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

export const deletePostMessage = (postId: string, account: string, issuedAt: string) =>
  `HonorCat: delete post ${postId}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

async function checkSigned(db: Db, account: Address, message: string, issuedAt: string, proof: { signature: Hex } | { passkey: WebAuthnAssertion }) {
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw fail("the signed request is too old; sign again", 401);
  if ("signature" in proof) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: proof.signature }))) throw fail("signature does not match the account", 401);
  } else await verifyPasskeyJoin(db, account, message, proof.passkey);
}

export type Snapshot = {
  side: number | null;
  /** The side in words: the team name for a group, YES/NO for a pot or perp. */
  sideText: string;
  state: string;
  entryPpm: number | null;
  practice: boolean;
  market: { title: string; label: string; instrument: string } | null;
};

const POT_STATES = ["None", "Open", "Joining", "Live", "ExitRequested", "Divided", "Settled", "Expired"];
const PERP_PHASES = ["None", "Open", "Funded", "Joining", "Running", "Ended"];
const GROUP_STATES = ["None", "Open", "Closed", "Settled", "Expired"];
const parse = <T>(d: unknown) => (typeof d === "string" ? JSON.parse(d) : d) as T;
const yesNo = (s: number | null) => (s === 0 ? "YES" : s === 1 ? "NO" : "a side");

async function marketOf(db: Db, conditionId: string | null | undefined) {
  if (!conditionId) return null;
  const m = (
    await db.query<{ title: string; label: string; instrument: string }>(
      "SELECT event_title AS title, label, instrument FROM pot_markets WHERE lower(condition_id) = lower($1)",
      [conditionId],
    )
  )[0];
  return m ?? null;
}

/**
 * What the author holds in the play they post about, or an error when they hold nothing there.
 * Exported for the tests.
 */
export async function snapshotOf(db: Db, about: About, account: string): Promise<Snapshot> {
  const a = account.toLowerCase();
  if (!/^\d{1,20}$/.test(about.id)) throw fail("no such play", 404);
  if (about.kind === "pot") {
    if ((await db.query("SELECT 1 FROM pot_private WHERE pot_id = $1", [about.id])).length) throw fail("private pots cannot be posted about", 403);
    const p = (await db.query<{ state: number; data: unknown; condition_id: string; yes_owner: string | null; no_owner: string | null }>("SELECT state, data, condition_id, yes_owner, no_owner FROM pots WHERE pot_id = $1", [about.id]))[0];
    if (!p) throw fail("no such pot", 404);
    let side: number | null = p.yes_owner?.toLowerCase() === a ? 0 : p.no_owner?.toLowerCase() === a ? 1 : null;
    if (side === null) {
      const t = (await db.query<{ token: string }>("SELECT args->>'tokenId' AS token FROM pot_events WHERE pot_id = $1 AND event_name = 'Transfer' AND lower(args->>'to') = $2 ORDER BY block_number DESC LIMIT 1", [about.id, a]))[0];
      if (t?.token) side = Number(BigInt(t.token) % 2n);
    }
    if (side === null) throw fail("you can only post about pots you have a side in", 403);
    const d = parse<Record<string, unknown>>(p.data);
    const practice = (await db.query("SELECT 1 FROM practice_pots WHERE pot_id = $1", [about.id])).length > 0;
    return { side, sideText: yesNo(side), state: POT_STATES[p.state] ?? "None", entryPpm: d.entry ? Number(d.entry) : null, practice, market: await marketOf(db, p.condition_id) };
  }
  if (about.kind === "perp") {
    const q = (await db.query<{ phase: number; a: string | null; b: string | null; data: unknown }>("SELECT phase, a, b, data FROM perps WHERE perp_id = $1", [about.id]))[0];
    if (!q) throw fail("no such perp", 404);
    const t = parse<{ t?: { conditionId?: string; creatorSide?: number } }>(q.data).t ?? {};
    const creatorSide = Number(t.creatorSide ?? 0);
    const side = q.a?.toLowerCase() === a ? creatorSide : q.b?.toLowerCase() === a ? 1 - creatorSide : null;
    if (side === null) throw fail("you can only post about perps you play in", 403);
    const practice = (await db.query("SELECT 1 FROM practice_pots WHERE pot_id = $1", [`-${about.id}`])).length > 0;
    return { side, sideText: yesNo(side), state: PERP_PHASES[q.phase] ?? "None", entryPpm: null, practice, market: await marketOf(db, t.conditionId) };
  }
  const g = (await db.query<{ state: number; condition_id: string; data: unknown }>("SELECT state, condition_id, data FROM groups WHERE group_id = $1", [about.id]))[0];
  if (!g) throw fail("no such group", 404);
  const m = (await db.query<{ team: number | null }>("SELECT team FROM group_members WHERE group_id = $1 AND account = $2 AND team IS NOT NULL", [about.id, a]))[0];
  if (!m || m.team === null) throw fail("you can only post about groups you are in", 403);
  const names = parse<{ names?: [string, string] | null }>(g.data).names ?? null;
  const side = Number(m.team);
  return { side, sideText: names?.[side] ?? yesNo(side), state: GROUP_STATES[g.state] ?? "None", entryPpm: null, practice: false, market: await marketOf(db, g.condition_id) };
}

export type Post = { id: string; author: string; body: string; about: About | null; snapshot: Snapshot | null; at: string };

type Row = { id: string; author: string; body: string; about_kind: About["kind"] | null; about_id: string | null; snapshot: unknown; at: string };
const toPost = (r: Row): Post => ({
  id: r.id,
  author: r.author,
  body: r.body,
  about: r.about_kind && r.about_id ? { kind: r.about_kind, id: r.about_id } : null,
  snapshot: r.snapshot ? parse<Snapshot>(r.snapshot) : null,
  at: new Date(r.at).toISOString(),
});

export async function createPost(
  db: Db,
  input: { account: Address; body: string; about?: About | null; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion }),
) {
  if (!socialOn()) throw fail("posts are switched off", 403);
  const account = getAddress(input.account);
  const body = cleanBody(input.body);
  if (body !== input.body) throw fail("the text changed while cleaning it; sign the cleaned text", 400);
  if (!body.length) throw fail("write something first", 400);
  if ([...body].length > POST_MAX) throw fail(`a post has at most ${POST_MAX} characters`, 400);
  const about = input.about ?? null;
  await checkSigned(db, account, postMessage(account, body, about, input.issuedAt), input.issuedAt, input);
  const a = account.toLowerCase();
  // the same signed post twice (a double click, a retried request) is stored once
  const same = (
    await db.query<Row>(
      "SELECT id::text AS id, author, body, about_kind, about_id, snapshot, at::text AS at FROM posts WHERE author = $1 AND issued_at = $2 AND body = $3 AND about_kind IS NOT DISTINCT FROM $4 AND about_id IS NOT DISTINCT FROM $5",
      [a, input.issuedAt, body, about?.kind ?? null, about?.id ?? null],
    )
  )[0];
  if (same) return toPost(same);
  const n = Number((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM posts WHERE author = $1 AND at > now() - interval '1 hour'", [a]))[0]?.n ?? 0);
  if (n >= POSTS_PER_HOUR) throw fail(`at most ${POSTS_PER_HOUR} posts an hour; try again later`, 429);
  const snapshot = about ? await snapshotOf(db, about, a) : null;
  const row = (
    await db.query<Row>(
      `INSERT INTO posts (author, body, about_kind, about_id, snapshot, issued_at) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text AS id, author, body, about_kind, about_id, snapshot, at::text AS at`,
      [a, body, about?.kind ?? null, about?.id ?? null, snapshot ? JSON.stringify(snapshot) : null, input.issuedAt],
    )
  )[0]!;
  return toPost(row);
}

export async function deletePost(db: Db, input: { postId: string; account: Address; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion })) {
  if (!socialOn()) throw fail("posts are switched off", 403);
  if (!/^\d{1,18}$/.test(input.postId)) throw fail("no such post", 404);
  const account = getAddress(input.account);
  const row = (await db.query<{ author: string }>("SELECT author FROM posts WHERE id = $1 AND NOT hidden", [input.postId]))[0];
  if (!row) throw fail("no such post", 404);
  if (row.author !== account.toLowerCase()) throw fail("only its author can delete a post", 403);
  await checkSigned(db, account, deletePostMessage(input.postId, account, input.issuedAt), input.issuedAt, input);
  await db.query("UPDATE posts SET hidden = true WHERE id = $1", [input.postId]);
  return { ok: true };
}

/**
 * Newest first, 30 a page (`before`: the last id seen). `scope`: everyone, the players `account`
 * follows (and their own posts), one author, or one play. Posts about a pot that has since been
 * made private are left out.
 */
export async function listPosts(
  db: Db,
  opts: { following?: string | null; author?: string | null; about?: About | null; before?: string | null; limit?: number } = {},
): Promise<Post[]> {
  const where = ["NOT p.hidden", "NOT (p.about_kind = 'pot' AND EXISTS (SELECT 1 FROM pot_private v WHERE v.pot_id = p.about_id))"];
  const args: unknown[] = [];
  const arg = (v: unknown) => (args.push(v), `$${args.length}`);
  if (opts.following) {
    const f = arg(opts.following.toLowerCase());
    where.push(`(p.author = ${f} OR p.author IN (SELECT leader FROM follows WHERE follower = ${f}))`);
  }
  if (opts.author) where.push(`p.author = ${arg(opts.author.toLowerCase())}`);
  if (opts.about) where.push(`p.about_kind = ${arg(opts.about.kind)} AND p.about_id = ${arg(opts.about.id)}`);
  if (opts.before && /^\d{1,18}$/.test(opts.before)) where.push(`p.id < ${arg(opts.before)}`);
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50);
  const rows = await db.query<Row>(
    `SELECT p.id::text AS id, p.author, p.body, p.about_kind, p.about_id, p.snapshot, p.at::text AS at
       FROM posts p WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT ${limit}`,
    args,
  );
  return rows.map(toPost);
}

/**
 * The plays an account can post about: its pots (not private), perps and groups of the last 30
 * days, newest first, for the "about" picker.
 */
export async function postablePlays(db: Db, account: string) {
  const a = account.toLowerCase();
  const since = Math.floor(Date.now() / 1000) - 30 * 86_400;
  const pots = await db.query<{ id: string }>(
    `SELECT DISTINCT ON (e.pot_id) e.pot_id::text AS id, e.block_number FROM pot_events e
      WHERE e.event_name = 'Transfer' AND lower(e.args->>'to') = $1 AND coalesce(e.block_time, 0) >= $2 AND e.pot_id > 0 AND e.pot_id < 9000000000
        AND NOT EXISTS (SELECT 1 FROM pot_private v WHERE v.pot_id = e.pot_id::text)
      ORDER BY e.pot_id, e.block_number DESC`,
    [a, since],
  );
  const perps = await db.query<{ id: string }>("SELECT perp_id::text AS id FROM perps WHERE (lower(a) = $1 OR lower(b) = $1) AND updated_at > now() - interval '30 days' ORDER BY perp_id DESC LIMIT 20", [a]);
  const groups = await db.query<{ id: string }>("SELECT group_id::text AS id FROM group_members WHERE account = $1 AND team IS NOT NULL ORDER BY group_id DESC LIMIT 20", [a]);
  const out: { about: About; snapshot: Snapshot }[] = [];
  const list: About[] = [
    ...pots.slice(0, 20).map((r) => ({ kind: "pot" as const, id: r.id })),
    ...perps.map((r) => ({ kind: "perp" as const, id: r.id })),
    ...groups.map((r) => ({ kind: "group" as const, id: r.id })),
  ];
  for (const about of list) {
    const s = await snapshotOf(db, about, a).catch(() => null);
    if (s) out.push({ about, snapshot: s });
  }
  return out;
}
