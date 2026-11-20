"use client";

import Link from "next/link";
import { useState } from "react";
import { getAddress } from "viem";
import { CatState } from "@/components/cat/CatState";
import { CatName } from "@/components/cat/PlayerCat";
import { C, F } from "@/components/cat/tokens";
import { FollowButton } from "@/components/pot/Follow";
import type { ActorState } from "@/components/pot/Who";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { getJson, usePolling } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { plainError } from "@/lib/messages";
import { nickname, useNames } from "@/lib/names";
import { tagName } from "@/lib/nickname";
import { joinChallenge, signChallenge } from "@/lib/passkey";

export type About = { kind: "pot" | "perp" | "group"; id: string };
type Snapshot = {
  side: number | null;
  sideText: string;
  state: string;
  entryPpm: number | null;
  practice: boolean;
  market: { title: string; label: string; instrument: string } | null;
};
export type Post = { id: string; author: string; body: string; about: About | null; snapshot: Snapshot | null; at: string };

export const POST_MAX = 280;

/** The same cleaning and messages the relay checks (relay/src/posts.ts). */
export function cleanBody(body: string) {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const postMessage = (account: string, body: string, about: About | null, issuedAt: string) =>
  `HonorCat: post${about ? ` about ${about.kind} ${about.id}` : ""}:\n${body}\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;
const deletePostMessage = (postId: string, account: string, issuedAt: string) => `HonorCat: delete post ${postId}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

async function proofFor(who: ActorState, message: string) {
  const actor = who.actor!;
  return actor.kind === "wallet" ? { signature: await actor.adapter.signMessage!(message) } : { passkey: await signChallenge(actor.session, await joinChallenge(message)) };
}

const STATE: Record<string, string> = {
  Open: "waiting for someone",
  Joining: "starting",
  Live: "running",
  ExitRequested: "someone was leaving",
  Divided: "ended",
  Settled: "ended",
  Expired: "ended",
  Funded: "starting",
  Running: "running",
  Ended: "ended",
  Closed: "closed",
};
const hrefOf = (a: About) => (a.kind === "perp" ? `/perps/${a.id}` : a.kind === "group" ? `/groups/${a.id}` : `/pots/${a.id}`);
const nameOf = (a: About) => `${a.kind} ${a.id}`;

/** "YES on UCF in pot 19 · Iowa State vs UCF · entered at 51.5%". */
export function playLine(a: About, s: Snapshot) {
  const label = s.market?.label && s.market.label !== "Yes" ? s.market.label : null;
  const side = a.kind === "group" ? s.sideText : `${s.sideText}${label ? ` on ${label}` : ""}`;
  return { side, title: s.market?.title ?? null, entry: s.entryPpm !== null ? `${(s.entryPpm / 10_000).toFixed(1)}%` : null };
}

/** Shows that posts are switched on (the API answers `on: false` otherwise). */
export function usePostsOn() {
  const { data } = usePolling<{ on: boolean }>("/api/hc/posts?about=pot:0", 300_000);
  return data?.on ?? null;
}

function PostCard({ p, name, who, mine, onDeleted }: { p: Post; name: string; who: ActorState; mine: boolean; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const line = p.about && p.snapshot ? playLine(p.about, p.snapshot) : null;
  return (
    <li style={{ display: "flex", flexDirection: "column", gap: 10, padding: "16px 4px", borderBottom: `1px solid ${C.faint}` }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center" }}>
        <Link href={`/record/${p.author}`} style={{ color: C.ink, fontWeight: 600 }}>
          <CatName account={p.author} name={name} />
        </Link>
        <time dateTime={p.at} style={{ color: C.muted, fontSize: 15 }}>
          {formatDate(Date.parse(p.at))}
        </time>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <FollowButton who={who} leader={p.author} name={name} />
          {mine && (
            <Button
              variant="quiet"
              size="sm"
              busy={busy}
              onClick={async () => {
                if (!window.confirm("Delete this post?")) return;
                setBusy(true);
                try {
                  const issuedAt = new Date().toISOString();
                  const proof = await proofFor(who, deletePostMessage(p.id, who.actor!.account, issuedAt));
                  await getJson("/api/hc/posts/delete", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ postId: p.id, account: who.actor!.account, issuedAt, ...proof }),
                  });
                  toast("Post deleted.");
                  onDeleted();
                } catch (e) {
                  toast(plainError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete
            </Button>
          )}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.body}</p>
      {p.about && p.snapshot && line && (
        <Link
          href={hrefOf(p.about)}
          style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", alignItems: "baseline", padding: "10px 12px", border: `1.5px solid ${C.ink}`, background: C.panel, color: C.ink, textDecoration: "none" }}
        >
          <span style={{ fontFamily: F.cond, fontSize: 22, fontWeight: 600 }}>{line.side}</span>
          <span style={{ fontSize: 15, color: C.body }}>
            {nameOf(p.about)}
            {line.title ? ` · ${line.title}` : ""}
            {line.entry ? ` · entered at ${line.entry}` : ""}
            {` · ${STATE[p.snapshot.state] ?? p.snapshot.state} when posted`}
            {p.snapshot.practice ? " · practice" : ""}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 14, color: C.muted }} title="The relay checked that the author held this side when posting.">
            checked side
          </span>
        </Link>
      )}
    </li>
  );
}

/** A list of posts from one API path (newest first), with "Show older". */
export function PostList({ path, who, empty }: { path: string; who: ActorState; empty: string }) {
  const { data, error } = usePolling<{ on: boolean; posts: Post[] }>(path, 15_000);
  const [older, setOlder] = useState<Post[]>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(true);
  const all = [...(data?.posts ?? []), ...older.filter((o) => !(data?.posts ?? []).some((p) => p.id === o.id))].filter((p) => !gone.has(p.id));
  const names = useNames(all.map((p) => p.author));
  const me = who.actor?.account.toLowerCase() ?? null;
  if (!data) return <CatState kind={error ? "error" : "loading"} text={error ? "Could not read the posts just now; trying again." : "Reading posts…"} size={90} />;
  if (!data.on) return <CatState kind="empty" text="Posts are not switched on here yet." size={90} />;
  if (!all.length) return <CatState kind="empty" text={empty} size={100} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
        {all.map((p) => (
          <PostCard key={p.id} p={p} who={who} mine={me === p.author} name={tagName(names[p.author] ?? nickname(p.author), p.author)} onDeleted={() => setGone(new Set([...gone, p.id]))} />
        ))}
      </ol>
      {more && all.length >= 30 && (
        <Button
          variant="quiet"
          size="sm"
          onClick={async () => {
            const last = all.at(-1)!.id;
            const r = await getJson<{ posts: Post[] }>(`${path}${path.includes("?") ? "&" : "?"}before=${last}`).catch(() => ({ posts: [] }));
            setOlder([...older, ...r.posts]);
            if (r.posts.length < 30) setMore(false);
          }}
        >
          Show older posts
        </Button>
      )}
    </div>
  );
}

type Play = { about: About; snapshot: Snapshot };

/** Write a post, optionally about one of your own pots, perps or groups. */
export function Composer({ who, about: fixed, onPosted }: { who: ActorState; about?: About | null; onPosted?: () => void }) {
  const me = who.actor?.account ?? null;
  const plays = usePolling<{ plays: Play[] }>(me ? `/api/hc/posts/plays?account=${me}` : null, 120_000);
  const [text, setText] = useState("");
  const [picked, setPick] = useState<string>("");
  const pick = fixed ? `${fixed.kind}:${fixed.id}` : picked;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!me) return null;
  const list = plays.data?.plays ?? [];
  const body = cleanBody(text);
  const count = [...body].length;
  const about: About | null = pick ? { kind: pick.split(":")[0] as About["kind"], id: pick.split(":")[1]! } : null;
  // a play passed in from a page: only its players post there (PlayPosts shows the form only to them)
  const fixedOk = !fixed || list.some((p) => p.about.kind === fixed.kind && p.about.id === fixed.id);
  const reason = !body ? "Write something first." : count > POST_MAX ? `At most ${POST_MAX} characters.` : null;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason) return;
        setBusy(true);
        setProblem(null);
        try {
          const issuedAt = new Date().toISOString();
          const proof = await proofFor(who, postMessage(me, body, about, issuedAt));
          await getJson("/api/hc/posts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ account: me, body, about, issuedAt, ...proof }),
          });
          setText("");
          toast("Posted.");
          window.dispatchEvent(new Event("hc:poll-fast"));
          onPosted?.();
        } catch (err) {
          setProblem(plainError(err));
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, border: `1.5px solid ${C.ink}`, background: C.panel }}
    >
      <Field label="Your post" hint={`${count} of ${POST_MAX} characters`} error={count > POST_MAX ? `At most ${POST_MAX} characters.` : problem}>
        {(id, describedBy) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            className="hc-input"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={about ? "Why this side? What are you watching for?" : "What are you watching?"}
            style={{ padding: "10px 12px", resize: "vertical", fontSize: 17, lineHeight: 1.45, fontFamily: "inherit" }}
          />
        )}
      </Field>
      {fixed ? null : (
        <Field label="About" hint="Attach one of your own pots, perps or groups: your side is shown, checked by HonorCat.">
          {(id, describedBy) => (
            <Select id={id} aria-describedby={describedBy} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Nothing, just a post</option>
              {list.map((p) => {
                const l = playLine(p.about, p.snapshot);
                return (
                  <option key={`${p.about.kind}:${p.about.id}`} value={`${p.about.kind}:${p.about.id}`}>
                    {`${l.side} · ${nameOf(p.about)}${l.title ? ` · ${l.title}` : ""}`}
                  </option>
                );
              })}
            </Select>
          )}
        </Field>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Button type="submit" busy={busy} disabled={!!reason || !fixedOk}>
          Post
        </Button>
        <span style={{ fontSize: 14, color: C.muted }}>Public. Signed with your {who.actor?.kind === "wallet" ? "wallet" : "passkey"}; moves no money.</span>
      </div>
    </form>
  );
}

/** Posts about one pot, perp or group, for its page; its players can post right there. */
export function PlayPosts({ about, who }: { about: About; who: ActorState }) {
  const on = usePostsOn();
  const me = who.actor?.account ?? null;
  const plays = usePolling<{ plays: Play[] }>(me && on ? `/api/hc/posts/plays?account=${me}` : null, 120_000);
  const player = !!plays.data?.plays.some((p) => p.about.kind === about.kind && p.about.id === about.id);
  if (!on) return null;
  return (
    <section aria-label="Posts" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>Posts</h2>
      {player && <Composer who={who} about={about} />}
      <PostList key={`${about.kind}:${about.id}`} path={`/api/hc/posts?about=${about.kind}:${about.id}`} who={who} empty={player ? "No posts yet. Say why you took your side." : "No posts about this yet."} />
    </section>
  );
}
