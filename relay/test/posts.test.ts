import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Signatures are checked locally (no chain): the accounts here are plain keys.
vi.mock("../src/chain", () => ({ publicClient: () => ({ verifyMessage }) }));

import { memoryDb } from "../src/db";
import { cleanBody, createPost, deletePost, deletePostMessage, listPosts, postablePlays, postMessage, type About } from "../src/posts";

const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const A = alice.address.toLowerCase();
const B = bob.address.toLowerCase();

async function post(who: typeof alice, body: string, about: About | null = null, issuedAt = new Date().toISOString()) {
  const signature = await who.signMessage({ message: postMessage(who.address, body, about, issuedAt) });
  return createPost(db, { account: who.address, body, about, issuedAt, signature });
}

let db: Awaited<ReturnType<typeof memoryDb>>;
beforeEach(async () => {
  process.env.SOCIAL = "on";
  db = await memoryDb();
  await db.query("INSERT INTO pot_markets (condition_id, instrument, event_ticker, contract_ticker, event_title, label, params) VALUES ('0x01', 'GEMI-X', 'X', 'UCF', 'Iowa State vs UCF', 'UCF', '{}')");
  await db.query("INSERT INTO pots (pot_id, state, data, condition_id, yes_owner, no_owner) VALUES (19, 3, '{\"entry\":\"515000\"}', '0x01', $1, $2), (20, 3, '{}', '0x01', $1, $2)", [A, B]);
});

describe("posts", () => {
  it("stores a signed post about the author's own side, with a snapshot of it", async () => {
    const p = await post(alice, "Took UCF early, the line looks cheap.", { kind: "pot", id: "19" });
    expect(p.snapshot).toMatchObject({ side: 0, sideText: "YES", state: "Live", entryPpm: 515000, market: { title: "Iowa State vs UCF" } });
    const q = await post(bob, "Other side for me.", { kind: "pot", id: "19" });
    expect(q.snapshot?.side).toBe(1);
    expect((await listPosts(db)).map((x) => x.body)).toEqual(["Other side for me.", "Took UCF early, the line looks cheap."]);
    expect((await listPosts(db, { about: { kind: "pot", id: "19" } })).length).toBe(2);
    expect((await listPosts(db, { author: A })).length).toBe(1);
  });

  it("refuses a post about a play the author has no side in, or a private pot", async () => {
    const carol = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
    await expect(post(carol, "hi", { kind: "pot", id: "19" })).rejects.toThrow(/only post about pots you have a side in/);
    await db.query("INSERT INTO pot_private (pot_id, key, by_account) VALUES ('20', 'k', $1)", [A]);
    await expect(post(alice, "hi", { kind: "pot", id: "20" })).rejects.toThrow(/private/);
  });

  it("hides posts about a pot made private later", async () => {
    await post(alice, "about 20", { kind: "pot", id: "20" });
    expect((await listPosts(db)).length).toBe(1);
    await db.query("INSERT INTO pot_private (pot_id, key, by_account) VALUES ('20', 'k', $1)", [A]);
    expect((await listPosts(db)).length).toBe(0);
  });

  it("needs the author's own signature, a fresh one, and clean short text", async () => {
    const issuedAt = new Date().toISOString();
    const forged = await bob.signMessage({ message: postMessage(alice.address, "hello", null, issuedAt) });
    await expect(createPost(db, { account: alice.address, body: "hello", issuedAt, signature: forged })).rejects.toThrow(/signature/);
    await expect(post(alice, "hello", null, "2020-01-01T00:00:00Z")).rejects.toThrow(/too old/);
    await expect(post(alice, "x".repeat(281))).rejects.toThrow(/at most 280/);
    await expect(post(alice, "  ")).rejects.toThrow();
    expect(cleanBody(" a‮ b \n\n\n\nc ")).toBe("a b\n\nc");
  });

  it("stores a retried request once and limits posts per hour", async () => {
    const at = new Date().toISOString();
    const one = await post(alice, "once", null, at);
    const again = await post(alice, "once", null, at);
    expect(again.id).toBe(one.id);
    // a different post signed at the same moment is its own post
    expect((await post(alice, "other", null, at)).id).not.toBe(one.id);
    await expect(post(alice, "not mine", { kind: "pot", id: "404" }, at)).rejects.toThrow(/no such pot/);
    for (let i = 0; i < 8; i++) await post(alice, `n${i}`, null, new Date(Date.now() + i + 1).toISOString());
    await expect(post(alice, "eleventh", null, new Date(Date.now() + 50).toISOString())).rejects.toThrow(/10 posts an hour/);
  });

  it("shows the following scope and lets only the author delete", async () => {
    const p = await post(bob, "from bob");
    await post(alice, "from alice");
    expect((await listPosts(db, { following: A })).map((x) => x.body)).toEqual(["from alice"]);
    await db.query("INSERT INTO follows (follower, leader) VALUES ($1, $2)", [A, B]);
    expect((await listPosts(db, { following: A })).length).toBe(2);
    const at = new Date().toISOString();
    const wrong = await alice.signMessage({ message: deletePostMessage(p.id, alice.address, at) });
    await expect(deletePost(db, { postId: p.id, account: alice.address, issuedAt: at, signature: wrong })).rejects.toThrow(/only its author/);
    const right = await bob.signMessage({ message: deletePostMessage(p.id, bob.address, at) });
    await deletePost(db, { postId: p.id, account: bob.address, issuedAt: at, signature: right });
    expect((await listPosts(db)).map((x) => x.body)).toEqual(["from alice"]);
  });

  it("is off unless SOCIAL=on", async () => {
    process.env.SOCIAL = "";
    await expect(post(alice, "hello")).rejects.toThrow(/switched off/);
  });

  it("lists the plays an author can post about", async () => {
    await db.query(
      "INSERT INTO pot_events (tx_hash, log_index, block_number, block_time, event_name, pot_id, args, source) VALUES ('0x01', 0, 1, $1, 'Transfer', 19, $2, 'test')",
      [Math.floor(Date.now() / 1000), JSON.stringify({ from: `0x${"0".repeat(40)}`, to: A, tokenId: "38" })],
    );
    const plays = await postablePlays(db, A);
    expect(plays.map((p) => p.about)).toEqual([{ kind: "pot", id: "19" }]);
  });
});
