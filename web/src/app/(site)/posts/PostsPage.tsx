"use client";

import Link from "next/link";
import { useState } from "react";
import { C, F } from "@/components/cat/tokens";
import { SignIn, useActor } from "@/components/pot/Who";
import { Composer, PostList, usePostsOn } from "@/components/social/Posts";

/** Posts from everyone or from the players you follow, and a place to write your own. */
export function PostsPage() {
  const who = useActor();
  const on = usePostsOn();
  const me = who.actor?.account ?? null;
  const [tab, setTab] = useState<"all" | "following">("all");
  const path = tab === "following" && me ? `/api/hc/posts?following=${me}` : "/api/hc/posts";
  const tabStyle = (active: boolean) =>
    ({
      padding: "8px 14px",
      border: `1.5px solid ${C.ink}`,
      background: active ? C.ink : "transparent",
      color: active ? C.page : C.ink,
      fontFamily: F.cond,
      fontSize: 20,
      fontWeight: 600,
      cursor: "pointer",
    }) as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 760 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Posts</h1>
        <p style={{ margin: 0, fontSize: 18, color: C.body, lineHeight: 1.5 }}>
          What players say about their sides. A post about a pot, perp or group shows the side its author held when posting, checked by HonorCat: only
          its players can post about it. Find players to follow on the <Link href="/leaderboard">leaderboard</Link>.
        </p>
      </header>
      {on !== false && (me ? <Composer who={who} /> : <SignIn who={who} purpose="Sign in to post and to see posts from the players you follow." />)}
      {me && on && (
        <div role="tablist" aria-label="Whose posts" style={{ display: "flex", gap: 0 }}>
          <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")} style={tabStyle(tab === "all")}>
            Everyone
          </button>
          <button type="button" role="tab" aria-selected={tab === "following"} onClick={() => setTab("following")} style={{ ...tabStyle(tab === "following"), borderLeft: "none" }}>
            Following
          </button>
        </div>
      )}
      <PostList
        key={path}
        path={path}
        who={who}
        empty={tab === "following" ? "Nothing yet from you or the players you follow." : "No posts yet. Be the first: say which side you took and why."}
      />
    </div>
  );
}
