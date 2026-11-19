/**
 * End-to-end run of perps (HonorCatPerps on HonorCatRopes v2.1) on Arc testnet against the deployed
 * app. The two players are throwaway wallets (keys in data/e2e-keys.jsonl, git-ignored); they open,
 * join, leave and stop renewing themselves. Everything else is the relay's and the samplers' job: the
 * first rope, its join window, knock-outs, expiries and every roll.
 *
 *   perp 1  9 lives each: a chain of ropes (expiries every --life minutes, knock-outs when the price moves)
 *   perp 2  1 life each: the chain ends when a player runs out of lives
 *   perp 3  3 lives each: player A leaves now once the first rope is live
 *   perp 4  3 lives each: player B stops renewing; the rope runs to its expiry and the chain ends
 *
 * At the end both wallets withdraw their free balances and send everything back to the deployer.
 *
 * Usage: cd relay && npx tsx --env-file=../.env scripts/perps-e2e.ts --symbol GEMI-… [--d 80000] [--size 10] [--life 10] [--minutes 60] [--plan chain,out,leave,stop]
 *        Clean-up only (an earlier run's wallets, from data/e2e-keys.jsonl):
 *        npx tsx --env-file=../.env scripts/perps-e2e.ts --sweep 1,2,3,4 --wallets 0xA…,0xB…
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, erc20Abi, http, maxUint256, parseEventLogs, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { markHouse } from "./house";
import { ARC_USDC } from "../src/arc";
import { perpsAbi } from "../src/perpsAbi";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    api: { type: "string", default: "https://honorcat.vercel.app" },
    symbol: { type: "string" },
    d: { type: "string", default: "80000" },
    size: { type: "string", default: "10" },
    life: { type: "string", default: "10" },
    minutes: { type: "string", default: "60" },
    plan: { type: "string", default: "chain,out,leave,stop" },
    sweep: { type: "string" },
    wallets: { type: "string" },
    // leave the perps running when the watch ends (showcase perps); without it they are wound down
    keep: { type: "boolean", default: false },
  },
});
const API = values.api!.replace(/\/$/, "");
const rpc = process.env.ARC_RPC_URL!;
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const dep = JSON.parse(readFileSync(new URL("../../deployments/5042002.ropes.json", import.meta.url), "utf8")) as { perps: Address; median: Address };
const PERPS = dep.perps;
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PHASES = ["None", "Open", "Funded", "Joining", "Running", "Ended"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t) as T;
}

type Acct = ReturnType<typeof privateKeyToAccount>;
const wallets: Acct[] = [];
function fresh() {
  const key = generatePrivateKey();
  const a = privateKeyToAccount(key);
  mkdirSync(new URL("../../data/", import.meta.url), { recursive: true });
  appendFileSync(new URL("../../data/e2e-keys.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), address: a.address, key }) + "\n");
  wallets.push(a);
  return a;
}

async function send(who: Acct, functionName: string, args: unknown[]) {
  const w = createWalletClient({ account: who, chain: arcTestnet, transport: http(rpc) });
  const h = await w.writeContract({ address: PERPS, abi: perpsAbi as never, functionName: functionName as never, args: args as never });
  const r = await client.waitForTransactionReceipt({ hash: h, timeout: 90_000 });
  if (r.status !== "success") throw new Error(`${functionName} reverted (${h})`);
  return r;
}

type Perp = { phase: number; pot: bigint; ropes: number; freeA: bigint; freeB: bigint; resultA: bigint; resultB: bigint };
const read = async (id: bigint) => (await client.readContract({ address: PERPS, abi: perpsAbi, functionName: "perp", args: [id] })) as unknown as Perp;

/** Withdraws every free balance of `who` in `ids` and sends the wallet's USDC (less gas) to `to`. */
async function sweep(who: Acct[], ids: bigint[], to: Address) {
  for (const w of who) {
    for (const id of ids) {
      const q = await read(id);
      const a = q as unknown as { a: string; b: string };
      const free = a.a.toLowerCase() === w.address.toLowerCase() ? q.freeA : a.b.toLowerCase() === w.address.toLowerCase() ? q.freeB : 0n;
      if (free > 0n) await send(w, "withdraw", [id, free]).then(() => log(`perp ${id}: ${w.address.slice(0, 8)} withdrew ${free}`));
    }
    const bal = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [w.address] });
    const keep = 30_000n; // gas for the transfer itself (Arc pays gas in USDC)
    if (bal > keep) {
      const ww = createWalletClient({ account: w, chain: arcTestnet, transport: http(rpc) });
      const h = await ww.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [to, bal - keep] });
      await client.waitForTransactionReceipt({ hash: h });
      log(`${w.address.slice(0, 8)} sent ${bal - keep} back`);
    }
  }
}

async function main() {
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const dw = createWalletClient({ account: deployer, chain: arcTestnet, transport: http(rpc) });
  if (values.sweep) {
    const keys = readFileSync(new URL("../../data/e2e-keys.jsonl", import.meta.url), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l) as { address: string; key: Hex });
    const who = (values.wallets ?? "").split(",").map((a) => keys.find((k) => k.address.toLowerCase() === a.trim().toLowerCase())).filter(Boolean).map((k) => privateKeyToAccount(k!.key));
    await sweep(who, values.sweep.split(",").map((x) => BigInt(x)), deployer.address);
    return;
  }
  if (!values.symbol) throw new Error("--symbol is required");
  // the market's rule and conditionId (as the app registers it)
  const prep = await api<{ conditionId: Hex; resolver: Address; closeTime: number; window: number; minSamples: number; midPpm: number | null }>(`/api/hc/prepare-rope`, {
    method: "POST",
    body: JSON.stringify({ symbol: values.symbol, account: PERPS, perpD: Number(values.d) }),
  });
  const d = Number(values.d);
  const size = BigInt(values.size!);
  const stake = BigInt(d / 100) * size;
  const treat = (stake * 25n) / 10_000n;
  log(`market ${values.symbol} at ${((prep.midPpm ?? 0) / 10_000).toFixed(1)}%: rope ±${d / 10_000} points, stake $${Number(stake) / 1e6} per side per rope`);
  const [A, B] = [fresh(), fresh()];
  await markHouse([A.address, B.address], "perps-e2e"); // HonorCat's own test players: never in honor or tables
  // Fund what the planned lives need (plus two stakes for the treat and gas), not a fixed 40 stakes.
  const maxLives = 9n;
  for (const w of wallets) {
    const h = await dw.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [w.address, (maxLives + 2n) * stake + 200_000n] });
    await client.waitForTransactionReceipt({ hash: h });
    const ww = createWalletClient({ account: w, chain: arcTestnet, transport: http(rpc) });
    const ha = await ww.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "approve", args: [PERPS, maxUint256] });
    await client.waitForTransactionReceipt({ hash: ha });
  }
  log(`funded A ${A.address} and B ${B.address}`);
  const terms = {
    conditionId: prep.conditionId,
    resolver: dep.median,
    creatorSide: 0,
    d,
    size,
    ropeLife: BigInt(Number(values.life) * 60),
    closeTime: BigInt(prep.closeTime),
    grace: 86_400n,
    window: prep.window,
    minSamples: prep.minSamples,
    tolerance: 30_000,
  };
  const all: Record<string, { name: string; livesA: bigint; livesB: bigint }> = {
    chain: { name: "chain", livesA: 9n, livesB: 9n },
    out: { name: "out of lives", livesA: 1n, livesB: 1n },
    leave: { name: "leave now", livesA: 3n, livesB: 3n },
    stop: { name: "stop renewing", livesA: 3n, livesB: 3n },
  };
  const plan = values.plan!.split(",").map((k) => all[k.trim()]!).filter(Boolean);
  const ids: bigint[] = [];
  for (const p of plan) {
    const r = await send(A, "open", [terms, p.livesA * stake]);
    const ev = parseEventLogs({ abi: perpsAbi, logs: r.logs, eventName: "PerpOpened" })[0]!;
    const id = (ev.args as { perpId: bigint }).perpId;
    await send(B, "join", [id, p.livesB * stake + treat]);
    ids.push(id);
    log(`perp ${id} (${p.name}): opened and joined; the relay starts the first rope`);
  }
  const done = new Set<number>();
  const acted = new Set<number>();
  const end = Date.now() + Number(values.minutes) * 60_000;
  const last: string[] = [];
  while (Date.now() < end && done.size < ids.length) {
    for (let i = 0; i < ids.length; i++) {
      if (done.has(i)) continue;
      const q = await read(ids[i]!);
      const line = `perp ${ids[i]} (${plan[i]!.name}): ${PHASES[q.phase]}, ropes ${q.ropes}, rope pot ${q.pot}, free A ${q.freeA} B ${q.freeB}, result A ${q.resultA}`;
      if (line !== last[i]) log(line);
      last[i] = line;
      if (q.phase === 4 && !acted.has(i)) {
        if (plan[i]!.name === "leave now") {
          await send(A, "leaveNow", [ids[i]]).then(() => log(`perp ${ids[i]}: A leaves now`)).catch((e) => log(`leaveNow failed: ${(e as Error).message.split("\n")[0]}`));
          acted.add(i);
        } else if (plan[i]!.name === "stop renewing") {
          await send(B, "stopRenewing", [ids[i]]).then(() => log(`perp ${ids[i]}: B stops renewing`));
          acted.add(i);
        }
      }
      if (q.phase === 5) {
        done.add(i);
        const r = await api<{ events: { name: string; args: Record<string, string> }[] }>(`/api/hc/perps/${ids[i]}`).catch(() => null);
        const ended = r?.events.find((e) => e.name === "PerpEnded");
        log(`perp ${ids[i]} ENDED after ${q.ropes} rope(s)${ended ? `: ${ended.args.why}` : ""}`);
      }
    }
    await sleep(20_000);
  }
  log(`finished: ${done.size} of ${ids.length} perps ended within the run`);
  // Perps still running: both stop renewing, so each ends at its rope's expiry; then clean up.
  if (!values.keep) for (let i = 0; i < ids.length; i++) if (!done.has(i)) for (const w of wallets) await send(w, "stopRenewing", [ids[i]]).catch(() => {});
  if (done.size === ids.length) await sweep(wallets, ids, deployer.address);
  else log(`clean up later: --sweep ${ids.join(",")} --wallets ${wallets.map((w) => w.address).join(",")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
