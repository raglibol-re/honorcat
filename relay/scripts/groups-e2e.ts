/**
 * Group pots end to end on Arc testnet: two fresh accounts (funded by the deployer) open a group on
 * a market, join opposite teams in the same batch, wait for the relay to price and clear it, then
 * the first leaves half and both take out what the group owes them. The relay's own loop (the
 * worker) does the clearing: this script only plays the two members and reports what happened.
 *
 *   npx tsx --env-file=../.env scripts/groups-e2e.ts --symbol GEMI-... [--amount 2] [--minutes 12]
 *   npx tsx --env-file=../.env scripts/groups-e2e.ts --sweep <groupId> --wallets 0xA,0xB
 *
 * Keys of the fresh accounts go to data/e2e-keys.jsonl so their money can be swept back.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, erc20Abi, http, maxUint256, parseEventLogs, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC_USDC } from "../src/arc";
import { getDb } from "../src/db";
import { groupsAbi } from "../src/groupsAbi";
import { prepareGroup } from "../src/groups";
import { depthResult } from "../src/pots";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    symbol: { type: "string" },
    amount: { type: "string", default: "2" },
    minutes: { type: "string", default: "12" },
    sweep: { type: "string" },
    wallets: { type: "string" },
  },
});
const rpc = process.env.ARC_RPC_URL!;
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const dep = JSON.parse(readFileSync(new URL("../../deployments/5042002.groups.json", import.meta.url), "utf8")) as { groups: Address; median: Address };
const GROUPS = dep.groups;
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (b: bigint) => `$${(Number(b) / 1e6).toFixed(4)}`;

type Acct = ReturnType<typeof privateKeyToAccount>;
function fresh() {
  const key = generatePrivateKey();
  const a = privateKeyToAccount(key);
  mkdirSync(new URL("../../data/", import.meta.url), { recursive: true });
  appendFileSync(new URL("../../data/e2e-keys.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), address: a.address, key, what: "groups-e2e" }) + "\n");
  return a;
}
async function send(who: Acct, functionName: string, args: unknown[]) {
  const w = createWalletClient({ account: who, chain: arcTestnet, transport: http(rpc) });
  const h = await w.writeContract({ address: GROUPS, abi: groupsAbi as never, functionName: functionName as never, args: args as never });
  const r = await client.waitForTransactionReceipt({ hash: h, timeout: 90_000 });
  if (r.status !== "success") throw new Error(`${functionName} reverted (${h})`);
  return r;
}
const group = async (id: bigint) => (await client.readContract({ address: GROUPS, abi: groupsAbi, functionName: "group", args: [id] })) as unknown as { nextBatch: bigint; state: number; balance: bigint; createdAt: bigint };
const position = async (id: bigint, who: Address) => (await client.readContract({ address: GROUPS, abi: groupsAbi, functionName: "positionOf", args: [id, who] })) as readonly [boolean, number, bigint, bigint];
const NONE = (1n << 64n) - 1n;

/** Waits until the group has no batch left to clear (or the time runs out). */
async function waitCleared(id: bigint, minutes: number) {
  const until = Date.now() + minutes * 60_000;
  let last = "";
  while (Date.now() < until) {
    const g = await group(id);
    const s = g.nextBatch === NONE ? "nothing waiting" : `batch ${g.nextBatch} next`;
    if (s !== last) log(`group ${id}: ${s}`);
    last = s;
    if (g.nextBatch === NONE) return true;
    await sleep(5_000);
  }
  return false;
}

async function collect(who: Acct, id: bigint) {
  await send(who, "claim", [id, who.address]);
  const owed = (await client.readContract({ address: GROUPS, abi: groupsAbi, functionName: "claimable", args: [id, who.address] })) as bigint;
  if (owed > 0n) await send(who, "withdraw", [id]);
  return owed;
}

async function sweep(who: Acct[], id: bigint, to: Address) {
  for (const w of who) {
    const owed = await collect(w, id).catch(() => 0n);
    if (owed) log(`${w.address.slice(0, 8)} took out ${usd(owed)}`);
    const bal = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [w.address] });
    const keep = 30_000n;
    if (bal > keep) {
      const ww = createWalletClient({ account: w, chain: arcTestnet, transport: http(rpc) });
      await client.waitForTransactionReceipt({ hash: await ww.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [to, bal - keep] }) });
      log(`${w.address.slice(0, 8)} sent ${usd(bal - keep)} back`);
    }
  }
}

async function main() {
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const dw = createWalletClient({ account: deployer, chain: arcTestnet, transport: http(rpc) });
  if (values.sweep) {
    const keys = readFileSync(new URL("../../data/e2e-keys.jsonl", import.meta.url), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l) as { address: string; key: Hex });
    const who = (values.wallets ?? "").split(",").map((a) => keys.find((k) => k.address.toLowerCase() === a.trim().toLowerCase())).filter(Boolean).map((k) => privateKeyToAccount(k!.key));
    await sweep(who, BigInt(values.sweep), deployer.address);
    return;
  }
  if (!values.symbol) throw new Error("--symbol is required");
  const amount = BigInt(Math.round(Number(values.amount) * 1e6));
  const db = await getDb();
  const [A, B] = [fresh(), fresh()];
  for (const w of [A, B]) {
    await client.waitForTransactionReceipt({ hash: await dw.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [w.address, amount + 300_000n] }) });
    const ww = createWalletClient({ account: w, chain: arcTestnet, transport: http(rpc) });
    await client.waitForTransactionReceipt({ hash: await ww.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "approve", args: [GROUPS, maxUint256] }) });
  }
  log(`funded A ${A.address} and B ${B.address}`);

  // The depth attestation is for A (the creator) and the groups contract; the app's sampler signs
  // here, the other samplers co-sign within seconds.
  const own = process.env.SAMPLER_KEY_VERCEL ? privateKeyToAccount(process.env.SAMPLER_KEY_VERCEL as Hex) : null;
  const prep = await prepareGroup(db, { symbol: values.symbol, account: A.address }, own);
  log(`market ${values.symbol} at ${((prep.midPpm ?? 0) / 10_000).toFixed(1)}%, cap ${usd(BigInt(prep.cap))} per team`);
  let sigs: Hex | null = null;
  for (let i = 0; i < 40 && !sigs; i++) {
    sigs = (await depthResult(db, prep.depthId))?.signatures ?? null;
    if (!sigs) await sleep(1500);
  }
  if (!sigs) throw new Error("the samplers did not co-sign the depth in time");
  const d = prep.depth;
  const depth = { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), spread: d.spread ?? 0, crypto: d.crypto ?? false, closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) };
  const r = await send(A, "create", [prep.resolver, depth, sigs, BigInt(prep.grace), prep.window, prep.minSamples, "Micky's team", "Morty's team"]);
  const ev = parseEventLogs({ abi: groupsAbi, logs: r.logs, eventName: "GroupCreated" })[0]!;
  const id = (ev.args as { groupId: bigint }).groupId;
  log(`group ${id} open (tx ${r.transactionHash}); page: /groups/${id}`);

  const t0 = Date.now();
  // The unmatched rest comes back after the first clearing (a rest that waits may wait 20 batches).
  await send(A, "join", [id, 0, amount, false]);
  await send(B, "join", [id, 1, amount, false]);
  log(`A joined Micky's team and B Morty's team with ${usd(amount)} each`);
  const ok = await waitCleared(id, Number(values.minutes));
  log(ok ? `cleared ${Math.round((Date.now() - t0) / 1000)} s after the joins` : "NOT cleared in time");
  if (!ok) return;
  await Promise.all([A, B].map((w) => send(w, "claim", [id, w.address])));
  const [pa, pb] = await Promise.all([position(id, A.address), position(id, B.address)]);
  log(`positions: A pays ${usd(pa[2])} if yes, B pays ${usd(pb[2])} if no`);

  const half = pa[2] / 2n;
  const t1 = Date.now();
  await send(A, "leave", [id, half]);
  log(`A leaves with ${usd(half)} of notional`);
  const ok2 = await waitCleared(id, Number(values.minutes));
  log(ok2 ? `leave cleared ${Math.round((Date.now() - t1) / 1000)} s after the request` : "leave NOT cleared in time");
  const got = await collect(A, id);
  await send(B, "claim", [id, B.address]);
  const [pa2, pb2] = await Promise.all([position(id, A.address), position(id, B.address)]);
  log(`A took out ${usd(got)}; now A pays ${usd(pa2[2])}, B pays ${usd(pb2[2])}; group holds ${usd((await group(id)).balance)}`);
  log(`done. Sweep later: --sweep ${id} --wallets ${A.address},${B.address}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
