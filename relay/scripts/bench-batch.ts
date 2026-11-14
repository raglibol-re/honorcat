/**
 * Phase A benchmark on Arc testnet: per-step transactions vs Arc's Multicall3From batching.
 *
 *  (a) create + fund one pot:  approve, createPot, fund (3 txs)  vs  one aggregate3
 *      [approve, BatchGuard.expectNextPotId, createPot, fund]
 *  (b) settle N pots:          N resolve txs, one after another  vs  one aggregate3 of N resolves,
 *                              and one aggregate3 of N Memo-wrapped resolves (reason attached)
 *
 * Pots use the deployer as resolver, so the live relay never touches them. Each pot holds
 * 0.01 USDC paid to one fresh payee. Reports gas, fee in USDC (gas is paid in USDC on Arc) and
 * wall time from first send to last receipt.
 *
 *   pnpm --filter @verdict/relay exec tsx --env-file=../.env scripts/bench-batch.ts --n 1,5,10 --runs 3
 */
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { batchGuardAbi, verdictVaultAbi } from "../src/abi";
import { arcFees, ARC_MULTICALL3_FROM, ARC_USDC } from "../src/arc";
import { memoCall } from "../src/memo";
import { signResolution } from "../src/signer";
import { multicall3FromAbi } from "../src/txs";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { n: { type: "string", default: "1,5,10" }, runs: { type: "string", default: "3" } },
});
const SIZES = values.n!.split(",").map(Number);
const RUNS = Number(values.runs);
const AMOUNT = 10_000n; // 0.01 USDC per pot

const me = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
const vault = getAddress(process.env.VAULT_ADDRESS!);
const guard = getAddress(process.env.BATCH_GUARD_ADDRESS!);
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL), pollingInterval: 500 });
const wallet = createWalletClient({ account: me, chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });

type M = { gas: bigint; feeWei: bigint; ms: number; txs: number };
const add = (a: M, r: TransactionReceipt) => ({ ...a, gas: a.gas + r.gasUsed, feeWei: a.feeWei + r.gasUsed * r.effectiveGasPrice, txs: a.txs + 1 });
const zero = (): M => ({ gas: 0n, feeWei: 0n, ms: 0, txs: 0 });

async function send(to: `0x${string}`, data: Hex) {
  const fees = await arcFees(pub);
  const hash = await wallet.sendTransaction({ to, data, ...fees } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx reverted ${hash}`);
  return r;
}

const terms = () => ({
  conditionId: keccak256(stringToHex(`bench-${Date.now()}-${Math.random()}`)),
  payees: [privateKeyToAccount(generatePrivateKey()).address],
  shares: [10_000],
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
});

const createCall = (t: ReturnType<typeof terms>) =>
  encodeFunctionData({ abi: verdictVaultAbi, functionName: "createPot", args: [t.conditionId, me.address, t.payees, t.shares, me.address, t.deadline] });

// ------------------------------------------------------------------ (a) create + fund

async function createSequential(): Promise<M> {
  const t = terms();
  const start = Date.now();
  let m = zero();
  m = add(m, await send(ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, AMOUNT] })));
  const rc = await send(vault, createCall(t));
  m = add(m, rc);
  const potId = parseEventLogs({ abi: verdictVaultAbi, logs: rc.logs, eventName: "PotCreated" })[0]!.args.potId;
  m = add(m, await send(vault, encodeFunctionData({ abi: verdictVaultAbi, functionName: "fund", args: [potId, AMOUNT] })));
  return { ...m, ms: Date.now() - start };
}

async function createBatched(): Promise<M> {
  const t = terms();
  const start = Date.now();
  const next = (await pub.readContract({ address: vault, abi: verdictVaultAbi, functionName: "potCount" })) + 1n;
  const r = await send(
    ARC_MULTICALL3_FROM,
    encodeFunctionData({
      abi: multicall3FromAbi,
      functionName: "aggregate3",
      args: [
        [
          { target: ARC_USDC, allowFailure: false, callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, AMOUNT] }) },
          { target: guard, allowFailure: false, callData: encodeFunctionData({ abi: batchGuardAbi, functionName: "expectNextPotId", args: [vault, next] }) },
          { target: vault, allowFailure: false, callData: createCall(t) },
          { target: vault, allowFailure: false, callData: encodeFunctionData({ abi: verdictVaultAbi, functionName: "fund", args: [next, AMOUNT] }) },
        ],
      ],
    }),
  );
  return { ...add(zero(), r), ms: Date.now() - start };
}

// ------------------------------------------------------------------ (b) settle N pots

/** Creates n funded pots in one batch (setup, not measured). */
async function setupPots(n: number) {
  const ts = Array.from({ length: n }, terms);
  const next = (await pub.readContract({ address: vault, abi: verdictVaultAbi, functionName: "potCount" })) + 1n;
  const calls = [
    { target: ARC_USDC, allowFailure: false, callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, AMOUNT * BigInt(n)] }) },
    { target: guard, allowFailure: false, callData: encodeFunctionData({ abi: batchGuardAbi, functionName: "expectNextPotId", args: [vault, next] }) },
    ...ts.flatMap((t, i) => [
      { target: vault, allowFailure: false, callData: createCall(t) },
      { target: vault, allowFailure: false, callData: encodeFunctionData({ abi: verdictVaultAbi, functionName: "fund", args: [next + BigInt(i), AMOUNT] }) },
    ]),
  ];
  await send(ARC_MULTICALL3_FROM, encodeFunctionData({ abi: multicall3FromAbi, functionName: "aggregate3", args: [calls] }));
  return ts.map((t, i) => ({ potId: next + BigInt(i), conditionId: t.conditionId }));
}

async function resolveData(p: { potId: bigint; conditionId: Hex }) {
  const signature = await signResolution(me, { chainId: arcTestnet.id, vault, potId: p.potId, conditionId: p.conditionId, outcome: true });
  return encodeFunctionData({ abi: verdictVaultAbi, functionName: "resolve", args: [p.potId, true, signature] });
}

async function settleSequential(n: number): Promise<M> {
  const pots = await setupPots(n);
  const datas = await Promise.all(pots.map(resolveData));
  const start = Date.now();
  let m = zero();
  for (const d of datas) m = add(m, await send(vault, d));
  return { ...m, ms: Date.now() - start };
}

async function settleBatched(n: number, withMemo: boolean): Promise<M> {
  const pots = await setupPots(n);
  const datas = await Promise.all(pots.map(resolveData));
  const calls = datas.map((d, i) =>
    withMemo
      ? { ...memoCall(vault, d, `bench-${pots[i]!.potId}`, { v: 1, t: "payout", pot: pots[i]!.potId.toString(), why: "Benchmark: condition met" }), allowFailure: false }
      : { target: vault, callData: d, allowFailure: false },
  );
  const start = Date.now();
  const r = await send(ARC_MULTICALL3_FROM, encodeFunctionData({ abi: multicall3FromAbi, functionName: "aggregate3", args: [calls] }));
  return { ...add(zero(), r), ms: Date.now() - start };
}

// ------------------------------------------------------------------ report

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
function summarize(label: string, ms: M[]) {
  const gas = median(ms.map((m) => Number(m.gas)));
  const fee = median(ms.map((m) => Number(m.feeWei) / 1e18));
  const time = median(ms.map((m) => m.ms));
  return { label, txs: ms[0]!.txs, gas, feeUsdc: fee, ms: time };
}

const rows: ReturnType<typeof summarize>[] = [];
async function measure(label: string, f: () => Promise<M>) {
  const out: M[] = [];
  for (let i = 0; i < RUNS; i++) out.push(await f());
  const s = summarize(label, out);
  rows.push(s);
  console.log(`${s.label.padEnd(44)} txs ${String(s.txs).padStart(2)}  gas ${String(s.gas).padStart(9)}  fee ${s.feeUsdc.toFixed(6)} USDC  time ${(s.ms / 1000).toFixed(2)} s`);
}

console.log(`Arc testnet, vault ${vault}, ${RUNS} runs each (median)`);
await measure("create+fund: approve, create, fund (3 txs)", createSequential);
await measure("create+fund: one Multicall3From batch", createBatched);
for (const n of SIZES) {
  await measure(`settle ${n}: ${n} resolve txs, sequential`, () => settleSequential(n));
  await measure(`settle ${n}: one batch`, () => settleBatched(n, false));
  await measure(`settle ${n}: one batch, memo per pot`, () => settleBatched(n, true));
}
console.log("\n| Operation | Txs | Gas | Fee (USDC) | Time to final |\n|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.label} | ${r.txs} | ${r.gas.toLocaleString("en-US")} | ${r.feeUsdc.toFixed(4)} | ${(r.ms / 1000).toFixed(2)} s |`);
