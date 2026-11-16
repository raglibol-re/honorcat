/**
 * The browser-wallet path end to end (what the app does for MetaMask, Rabby & co. since they no
 * longer sign token transfers): two plain wallets send their own transactions on Arc testnet.
 *   creator: approve exactly its escrow → create(…, auth.v = 0)
 *   joiner:  approve exactly its escrow → requestJoin(potId, auth.v = 0) → the app re-reads the pot
 *   samplers price the join; creator: requestExit (a transaction) → divided.
 * Both pay Arc's fee in USDC. Leftovers are swept back to DEPLOYER_PRIVATE_KEY.
 * Usage: tsx --env-file=../.env scripts/pots-wallet-e2e.ts [--api …] [--symbol GEMI-…]
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
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t) as T;
}
const ZERO = `0x${"0".repeat(64)}` as Hex;
const noAuth = (from: Address) => ({ from, validAfter: 0n, validBefore: 0n, salt: ZERO, v: 0, r: ZERO, s: ZERO });

async function send(w: ReturnType<typeof privateKeyToAccount>, to: Address, data: Hex) {
  const wc = createWalletClient({ account: w, chain: arcTestnet, transport: http(rpc) });
  const h = await wc.sendTransaction({ to, data });
  const r = await client.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw new Error(`reverted: ${h}`);
  return r;
}

const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
const creator = privateKeyToAccount(generatePrivateKey());
const joiner = privateKeyToAccount(generatePrivateKey());
const notional = 1_000_000n;

async function main() {
  const dw = createWalletClient({ account: deployer, chain: arcTestnet, transport: http(rpc) });
  for (const w of [creator, joiner]) await client.waitForTransactionReceipt({ hash: await dw.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [w.address, 1_500_000n] }) });
  const symbol = values.symbol ?? "GEMI-NBA-2611170000-ORL-BOS-M-BOS";
  type Prep = { conditionId: Hex; resolver: Address; pots: Address; closeTime: number; window: number; minSamples: number; depthId: string; depth: { conditionId: Hex; account: Address; contracts5c: string; closeTime: string; validUntil: string }; midPpm: number };
  const prep = await api<Prep>(`/api/hc/prepare`, { method: "POST", body: JSON.stringify({ symbol, account: creator.address }) });
  let sigs: Hex | null = null;
  for (let i = 0; i < 30 && !sigs; i++) {
    sigs = (await api<{ signatures: Hex | null }>(`/api/hc/depth?id=${encodeURIComponent(prep.depthId)}`)).signatures;
    if (!sigs) await sleep(1500);
  }
  if (!sigs) throw new Error("depth not co-signed");
  const c = { conditionId: prep.conditionId, resolver: prep.resolver, side: 0, notional, bandCenter: prep.midPpm, tolerance: 50_000, closeTime: BigInt(prep.closeTime), grace: 86_400n, window: prep.window, minSamples: prep.minSamples };
  const d = prep.depth;
  const escrow = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "worstCase", args: [0, notional, c.bandCenter, c.tolerance] });
  await send(creator, ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [prep.pots, escrow] }));
  const r = await send(creator, prep.pots, encodeFunctionData({
    abi: potsAbi,
    functionName: "create",
    args: [c, { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) }, sigs, noAuth(creator.address)],
  }));
  const potId = (parseEventLogs({ abi: potsAbi, logs: r.logs, eventName: "PotCreated" })[0]!.args as { potId: bigint }).potId;
  log(`creator approved ${Number(escrow) / 1e6} USDC and created pot ${potId} with its own transaction (${r.transactionHash})`);
  await api(`/api/hc/pots/${potId}`, { method: "POST" });

  const joinEscrow = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "worstCase", args: [1, notional, c.bandCenter, c.tolerance] });
  await send(joiner, ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [prep.pots, joinEscrow] }));
  const j = await send(joiner, prep.pots, encodeFunctionData({ abi: potsAbi, functionName: "requestJoin", args: [potId, noAuth(joiner.address)] }));
  await api(`/api/hc/pots/${potId}`, { method: "POST" }); // as the app does after a wallet transaction
  log(`joiner approved ${Number(joinEscrow) / 1e6} USDC and requested to join (${j.transactionHash})`);

  const waitState = async (want: string[]) => {
    for (let i = 0; i < 90; i++) {
      const s = await api<{ state: string; requests: { id: string; payload: { reason?: string } }[] }>(`/api/hc/pots/${potId}`);
      if (want.includes(s.state)) return s;
      await sleep(4000);
    }
    throw new Error("timeout");
  };
  const live = await waitState(["Live", "Open"]);
  log(`${live.state}: ${live.requests[0]?.payload.reason}`);
  if (live.state !== "Live") throw new Error("join did not go through");
  await sleep(3000);
  await send(creator, prep.pots, encodeFunctionData({ abi: potsAbi, functionName: "requestExit", args: [potId, 0, notional] }));
  await api(`/api/hc/pots/${potId}`, { method: "POST" });
  log("creator asked to leave with an ordinary transaction");
  const end = await waitState(["Divided", "Live"]);
  log(`${end.state}: ${end.requests[0]?.payload.reason}`);
  if (end.state !== "Divided") process.exitCode = 1;
}

async function sweep() {
  for (const a of [creator, joiner]) {
    const b = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [a.address] });
    if (b > 30_000n) await send(a, ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [deployer.address, b - 30_000n] })).catch(() => {});
  }
  log("leftovers swept back");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sweep().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
