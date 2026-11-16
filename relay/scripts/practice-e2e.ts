/**
 * The solo try-out, timed, as a first-time visitor with a brand-new wallet and no money:
 *   "Get 2 test USDC" → create a $1 pot (exact approval + transaction) → the practice cat joins
 *   → live → leave (a transaction) → divided. Must take under two minutes (excluding the gift's
 *   own few seconds). Leftovers are swept back to DEPLOYER_PRIVATE_KEY.
 * Usage: tsx --env-file=../.env scripts/practice-e2e.ts [--api …] [--symbol GEMI-…]
 */
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseEventLogs, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC_USDC } from "../src/arc";
import { potsAbi } from "../src/potsAbi";

const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { api: { type: "string", default: "https://honorcat.vercel.app" }, symbol: { type: "string" } } });
const API = values.api!.replace(/\/$/, "");
const rpc = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const t0 = Date.now();
const log = (m: string) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t) as T;
}
const ZERO = `0x${"0".repeat(64)}` as Hex;
const me = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account: me, chain: arcTestnet, transport: http(rpc) });
async function send(to: Address, data: Hex) {
  const r = await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to, data }) });
  if (r.status !== "success") throw new Error("reverted");
  return r;
}
const bal = () => client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [me.address] });

async function main() {
  log(`new visitor ${me.address}, balance ${Number(await bal()) / 1e6} USDC`);
  const gift = await api<{ sent: boolean; reason?: string }>(`/api/hc/drip`, { method: "POST", body: JSON.stringify({ account: me.address }) }).catch((e) => ({ sent: false, reason: (e as Error).message }));
  if (!gift.sent) throw new Error(`no gift: ${gift.reason}`);
  for (let i = 0; i < 20 && (await bal()) === 0n; i++) await sleep(1000);
  log(`"Get 2 test USDC": balance ${Number(await bal()) / 1e6} USDC`);
  const start = Date.now();

  const symbol = values.symbol ?? (await api<{ items: { symbol: string; closeMs: number; book: { bid: number | null; ask: number | null } | null }[] }>(`/api/catalog?usable=1&limit=100`)).items.find((x) => x.book?.bid && x.book.ask && x.book.ask - x.book.bid <= 0.02 && x.closeMs - Date.now() > 3600_000)!.symbol;
  type Prep = { conditionId: Hex; resolver: Address; pots: Address; closeTime: number; window: number; minSamples: number; depthId: string; depth: { conditionId: Hex; account: Address; contracts5c: string; closeTime: string; validUntil: string }; midPpm: number };
  const prep = await api<Prep>(`/api/hc/prepare`, { method: "POST", body: JSON.stringify({ symbol, account: me.address }) });
  let sigs: Hex | null = null;
  for (let i = 0; i < 30 && !sigs; i++) {
    sigs = (await api<{ signatures: Hex | null }>(`/api/hc/depth?id=${encodeURIComponent(prep.depthId)}`)).signatures;
    if (!sigs) await sleep(1000);
  }
  if (!sigs) throw new Error("depth not co-signed");
  const n = 1_000_000n;
  const c = { conditionId: prep.conditionId, resolver: prep.resolver, side: 0, notional: n, bandCenter: prep.midPpm, tolerance: 50_000, closeTime: BigInt(prep.closeTime), grace: 3n * 86_400n, window: prep.window, minSamples: prep.minSamples };
  const escrow = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "worstCase", args: [0, n, c.bandCenter, c.tolerance] });
  await send(ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [prep.pots, escrow] }));
  const d = prep.depth;
  const r = await send(prep.pots, encodeFunctionData({
    abi: potsAbi,
    functionName: "create",
    args: [c, { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) }, sigs, { from: me.address, validAfter: 0n, validBefore: 0n, salt: ZERO, v: 0, r: ZERO, s: ZERO }],
  }));
  const potId = (parseEventLogs({ abi: potsAbi, logs: r.logs, eventName: "PotCreated" })[0]!.args as { potId: bigint }).potId.toString();
  await api(`/api/hc/pots/${potId}`, { method: "POST" });
  log(`created pot ${potId} ($1 on YES)`);
  await api(`/api/hc/practice`, { method: "POST", body: JSON.stringify({ potId }) });
  log("the practice cat took the other side; the entry price is being measured");

  const waitState = async (want: string[]) => {
    for (let i = 0; i < 60; i++) {
      const s = await api<{ state: string; practice?: boolean; requests: { payload: { reason?: string } }[] }>(`/api/hc/pots/${potId}`);
      if (want.includes(s.state)) return s;
      await sleep(2000);
    }
    throw new Error("timeout");
  };
  const live = await waitState(["Live", "Open"]);
  log(`${live.state} (practice: ${live.practice}): ${live.requests[0]?.payload.reason}`);
  if (live.state !== "Live") throw new Error("the practice join did not go through");
  await send(prep.pots, encodeFunctionData({ abi: potsAbi, functionName: "requestExit", args: [BigInt(potId), 0, n] }));
  await api(`/api/hc/pots/${potId}`, { method: "POST" });
  log("left with a transaction; the exit price is being measured");
  const end = await waitState(["Divided", "Live"]);
  const secs = (Date.now() - start) / 1000;
  log(`${end.state}: ${end.requests[0]?.payload.reason}. From "create" to paid out: ${secs.toFixed(0)} s`);
  if (end.state !== "Divided" || secs > 120) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const b = await bal().catch(() => 0n);
    if (b > 30_000n) await send(ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex).address, b - 30_000n] })).catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
