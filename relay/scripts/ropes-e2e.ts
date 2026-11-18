/**
 * End-to-end run of HonorCat v2 (short ropes) on Arc testnet against the deployed app, testnet USDC
 * only. The wallets call HonorCatRopes themselves (each pays its own gas, in USDC); the app's relay and
 * the samplers do everything else: depth attestation, entry windows, exit/knock-out/expiry windows and
 * the submissions.
 *
 *   --scenario short     pot 1: A (YES) vs B (NO), a two-sided rope; A buys an extra life once live; it
 *                        ends at its expiry (or earlier by knock-out). Pots 2 and 3: C copies A's YES
 *                        and B's NO; both expire, and the copy that ends in profit pays its leader 5%.
 *   --scenario knock     one 10× two-sided rope (posts 5 points away) on a crypto market, expiring as late
 *                        as allowed; it ends by knock-out when the price holds at a post (not forced).
 *
 * Usage: cd relay && npx tsx --env-file=../.env scripts/ropes-e2e.ts --scenario short [--symbol GEMI-…]
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, erc20Abi, http, maxUint256, parseEventLogs, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC_USDC } from "../src/arc";
import { ropesAbi } from "../src/ropesAbi";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    api: { type: "string", default: "https://honorcat.vercel.app" },
    symbol: { type: "string" },
    scenario: { type: "string", default: "short" },
    symbolCheck: { type: "boolean", default: false },
    expiryMin: { type: "string", default: "12" },
    dist: { type: "string", default: "60000" },
    size: { type: "string", default: "50" },
    fund: { type: "string", default: "150000" },
  },
});
const API = values.api!.replace(/\/$/, "");
const rpc = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROPE_BASE = 1_000_000_000n;
const DIST = Number(values.dist);
const SIZE = BigInt(values.size!);
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const noAuth = (from: Address) => ({ from, validAfter: 0n, validBefore: 0n, salt: ZERO32, v: 0, r: ZERO32, s: ZERO32 });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 400)}`);
  return JSON.parse(t) as T;
}

type Acct = ReturnType<typeof privateKeyToAccount>;
const wallets: Acct[] = [];
/** A throwaway wallet whose key is kept in data/e2e-keys.jsonl (git-ignored), so its leftover is never lost. */
const fresh = () => {
  const key = generatePrivateKey();
  const a = privateKeyToAccount(key);
  mkdirSync(new URL("../../data/", import.meta.url), { recursive: true });
  appendFileSync(new URL("../../data/e2e-keys.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), address: a.address, key }) + "\n");
  wallets.push(a);
  return a;
};

/** Returns what is left in the throwaway wallets to `to`. */
async function sweep(to: Address) {
  for (const a of wallets) {
    const b = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [a.address] });
    const keep = 20_000n;
    if (b <= keep) continue;
    const w = createWalletClient({ account: a, chain: arcTestnet, transport: http(rpc) });
    try {
      const h = await w.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [to, b - keep] });
      await client.waitForTransactionReceipt({ hash: h });
      log(`swept ${Number(b - keep) / 1e6} USDC from ${a.address} back`);
    } catch (e) {
      log(`could not sweep ${a.address}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

async function send(who: Acct, functionName: string, args: unknown[]) {
  const w = createWalletClient({ account: who, chain: arcTestnet, transport: http(rpc) });
  const h = await w.writeContract({ address: ROPES, abi: ropesAbi as never, functionName: functionName as never, args: args as never });
  const r = await client.waitForTransactionReceipt({ hash: h, timeout: 90_000 });
  if (r.status !== "success") throw new Error(`${functionName} reverted (${h})`);
  return r;
}

async function sync(dbId: string) {
  await api(`/api/hc/pots/${dbId}`, { method: "POST" }).catch(() => null);
}

type Detail = { state: string; data: Record<string, string>; requests: { id: string; status: string; error: string | null }[]; events: { name: string; args: Record<string, string> }[] };
async function waitState(dbId: string, want: string[], maxMs: number) {
  const end = Date.now() + maxMs;
  let last = "";
  for (;;) {
    const d = await api<Detail>(`/api/hc/pots/${dbId}`).catch(() => null);
    if (d) {
      const line = `${d.state} | ${d.requests.slice(0, 2).map((r) => `${r.id}:${r.status}${r.error ? "(" + r.error.slice(0, 70) + ")" : ""}`).join(" ")}`;
      if (line !== last) log(`pot ${dbId}: ${line}`);
      last = line;
      if (want.includes(d.state)) return d;
    }
    if (Date.now() > end) throw new Error(`pot ${dbId} not ${want.join("/")} after ${maxMs / 1000}s`);
    await sleep(5000);
  }
}

let ROPES = "0x0000000000000000000000000000000000000000" as Address;
type Prep = { conditionId: Hex; resolver: Address; pots: Address; closeTime: number; window: number; minSamples: number; depthId: string; depth: { conditionId: Hex; account: Address; contracts5c: string; spread: number; crypto: boolean; closeTime: string; validUntil: string }; maxSize: string; midPpm: number | null; crypto: boolean; spread: number; market: { symbol: string; eventTitle: string; label: string } };

/** Creates a two-sided rope (posts `dist` ppm on both sides) and returns its database id. */
async function createRope(who: Acct, symbol: string, o: { side: number; size: bigint; dist: number; expiry: number; copyOf?: bigint }) {
  const prep = await api<Prep>(`/api/hc/prepare-rope`, { method: "POST", body: JSON.stringify({ symbol, account: who.address }) });
  ROPES = prep.pots;
  let sigs: Hex | null = null;
  for (let i = 0; i < 40 && !sigs; i++) {
    sigs = (await api<{ signatures: Hex | null }>(`/api/hc/depth?id=${encodeURIComponent(prep.depthId)}`)).signatures;
    if (!sigs) await sleep(2000);
  }
  if (!sigs) throw new Error("depth not co-signed (are two samplers running the v2 code?)");
  const center = Math.round((prep.midPpm ?? 500_000) / 100) * 100;
  const c = {
    conditionId: prep.conditionId,
    resolver: prep.resolver,
    side: o.side,
    size: o.size,
    bandCenter: center,
    tolerance: 0,
    distYes: o.dist,
    distNo: o.dist,
    expiry: BigInt(o.expiry),
    closeTime: BigInt(prep.closeTime),
    grace: 86_400n,
    window: prep.window,
    minSamples: prep.minSamples,
    copyOf: o.copyOf ?? 0n,
  };
  const d = prep.depth;
  const r = await send(who, "create", [c, { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), spread: d.spread, crypto: d.crypto, closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) }, sigs, noAuth(who.address)]);
  const ev = parseEventLogs({ abi: ropesAbi, logs: r.logs, eventName: "PotCreated" })[0]!;
  const dbId = (ROPE_BASE + (ev.args as { potId: bigint }).potId).toString();
  await sync(dbId);
  log(`created pot ${dbId} on ${prep.market.eventTitle} / ${prep.market.label} at ${center / 10_000}%: posts ±${o.dist / 10_000} points, size ${o.size}${o.copyOf ? `, copy of token ${o.copyOf}` : ""}`);
  return dbId;
}

async function join(who: Acct, dbId: string) {
  await send(who, "requestJoin", [BigInt(dbId) - ROPE_BASE, 0n, noAuth(who.address)]);
  await sync(dbId);
  return waitState(dbId, ["Live", "Open"], 240_000);
}

async function pickSymbol(crypto: boolean) {
  if (values.symbol) return values.symbol;
  const list = await api<{ items: { symbol: string; category: string; closeMs: number; book: { bid: number | null; ask: number | null; bidDepth: number; askDepth: number } | null }[] }>(`/api/catalog?usable=1&limit=300`);
  const ok = list.items.filter(
    (x) =>
      x.book &&
      x.book.bid !== null &&
      x.book.ask !== null &&
      x.book.ask - x.book.bid <= 0.025 &&
      x.book.bid >= 0.3 &&
      x.book.ask <= 0.7 &&
      Math.min(x.book.bidDepth, x.book.askDepth) >= 20 &&
      x.closeMs - Date.now() > 4 * 3600_000 &&
      (!crypto || x.category === "Crypto"),
  );
  ok.sort((a, b) => Math.abs((a.book!.bid! + a.book!.ask!) / 2 - 0.5) - Math.abs((b.book!.bid! + b.book!.ask!) / 2 - 0.5));
  if (!ok[0]) throw new Error("no suitable market right now");
  return ok[0].symbol;
}

async function main() {
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const dw = createWalletClient({ account: deployer, chain: arcTestnet, transport: http(rpc) });
  // Market first: nothing is funded unless there is a market to play on.
  const symbol = await pickSymbol(true); // 5-point posts at 50% are 10×: crypto markets only
  const [A, B] = [fresh(), fresh()];
  for (const w of wallets) {
    const h = await dw.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [w.address, BigInt(values.fund!)] });
    await client.waitForTransactionReceipt({ hash: h });
  }
  log(`market ${symbol}; funded ${wallets.length} wallets with $${Number(values.fund) / 1e6} each (keys in data/e2e-keys.jsonl)`);
  try {
    await run(symbol, A, B);
  } finally {
    await sweep(deployer.address);
  }
}

async function run(symbol: string, A: Acct, B: Acct) {
  const status = await api<{ available: boolean; address: Address | null }>(`/api/hc/ropes`);
  if (!status.available || !status.address) throw new Error("the app does not see HonorCat v2 yet");
  ROPES = status.address;
  for (const w of wallets) {
    const ww = createWalletClient({ account: w, chain: arcTestnet, transport: http(rpc) });
    const h = await ww.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "approve", args: [ROPES, maxUint256] });
    await client.waitForTransactionReceipt({ hash: h });
  }

  if (values.scenario === "knock") {
    const prepClose = (await api<Prep>(`/api/hc/prepare-rope`, { method: "POST", body: JSON.stringify({ symbol, account: A.address }) })).closeTime;
    const expiry = Math.min(Math.floor(Date.now() / 1000) + 7 * 86_400, prepClose - 7200 - 60);
    const id = await createRope(A, symbol, { side: 0, size: SIZE, dist: DIST, expiry });
    await join(B, id);
    log(`pot ${id} is live: it ends by knock-out when the price holds 5 points away, or at ${new Date(expiry * 1000).toISOString()}`);
    return;
  }

  const expiry = Math.floor(Date.now() / 1000) + Number(values.expiryMin) * 60;
  // pot 1: A YES vs B NO
  const p1 = await createRope(A, symbol, { side: 0, size: SIZE, dist: DIST, expiry });
  const live = await join(B, p1);
  if (live.state !== "Live") throw new Error(`pot ${p1} did not go live (entry price outside the band?)`);
  // extra life for A (YES) right away
  await send(A, "addLife", [BigInt(p1) - ROPE_BASE, 0, noAuth(A.address)]);
  await sync(p1);
  const after = await api<Detail>(`/api/hc/pots/${p1}`);
  log(`extra life: YES's post moved to ${Number(after.data.lower) / 10_000} (lives ${after.data.livesYes})`);
  // pots 2 and 3: B copies A's YES (A takes NO), A copies B's NO (B takes YES). Same market, so whichever
  // way the price moves one copy ends in profit and pays its leader 5% of it.
  const tokYes = (BigInt(p1) - ROPE_BASE) * 2n;
  const later = () => Math.max(expiry + 60, Math.floor(Date.now() / 1000) + 11 * 60); // at least 10 minutes of life when created
  const p2 = await createRope(B, symbol, { side: 0, size: SIZE, dist: DIST, expiry: later(), copyOf: tokYes });
  await join(A, p2);
  const p3 = await createRope(A, symbol, { side: 1, size: SIZE, dist: DIST, expiry: later(), copyOf: tokYes + 1n });
  await join(B, p3);
  log("waiting for the expiries (the samplers measure the windows fixed by each expiry)…");
  for (const id of [p1, p2, p3]) {
    const d = await waitState(id, ["Divided", "Settled", "Expired"], (Number(values.expiryMin) + 25) * 60_000);
    const div = d.events.find((e) => e.name === "PotDivided");
    const treat = d.events.find((e) => e.name === "CopycatTreat");
    log(`pot ${id}: ${d.state}, ${div ? `reason ${["exit", "knock-out", "expiry", "handshake"][Number(div.args.reason)]} at ${(Number(div.args.price) / 10_000).toFixed(2)}%: YES ${div.args.paidYes}, NO ${div.args.paidNo}` : ""}${treat ? `; copycat treat ${treat.args.amount} to the leader on a profit of ${treat.args.profit}` : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
