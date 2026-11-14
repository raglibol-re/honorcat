/**
 * End-to-end run against a deployed (or local) Verdict API, with no manual steps:
 *   1. create and fund a pot with testnet USDC
 *   2. set the result through the relay (ManualSource)
 *   3. wait for the relay to pay out / refund on-chain
 *   4. check the payments appear in the API that the web ledger reads
 *
 * Usage:
 *   pnpm --filter @verdict/relay e2e -- --api https://<app>.vercel.app --outcome both
 * Env: DEPLOYER_PRIVATE_KEY (funder), ADMIN_TOKEN (must match the server), ARC_RPC_URL, USDC_ADDRESS.
 */
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { verdictVaultAbi } from "../src/abi";

const { values } = parseArgs({
  options: {
    api: { type: "string", default: "http://localhost:3000" },
    outcome: { type: "string", default: "both" },
    amount: { type: "string", default: "0.10" },
    timeout: { type: "string", default: "180" },
  },
});

const API = values.api!.replace(/\/$/, "");
const TIMEOUT_MS = Number(values.timeout) * 1000;
const AMOUNT = BigInt(Math.round(Number(values.amount) * 1e6)); // USDC, 6 decimals
const RPC = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const USDC = getAddress(process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000");
const EXPLORER = "https://explorer.testnet.arc.io";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const funder = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex);
const adminToken = need("ADMIN_TOKEN");
const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const wallet = createWalletClient({ account: funder, chain: arcTestnet, transport: http(RPC) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usdc = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function api<T>(path: string, init?: RequestInit & { json?: unknown; auth?: boolean }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    method: init?.json !== undefined ? "POST" : (init?.method ?? "GET"),
    headers: {
      "content-type": "application/json",
      ...(init?.auth ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${path} -> ${res.status} ${text}`), { status: res.status });
  return JSON.parse(text) as T;
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, everyMs = 2000): Promise<T> {
  const until = Date.now() + TIMEOUT_MS;
  let lastErr: unknown;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v !== undefined) return v;
    } catch (err) {
      lastErr = err;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${what}${lastErr ? `: ${(lastErr as Error).message}` : ""}`);
}

type Health = { ok: boolean; chainId: number; vault: Address; resolver: Address | null };
type PotDetail = {
  pot: { potId: number; status: string; outcome: boolean | null; total: string };
  payments: { kind: string; recipient: string; amount: string; txHash: string }[];
  relay: { status: string; tx_hash: string | null; last_error: string | null } | null;
};

async function runOnce(health: Health, outcome: boolean) {
  const label = outcome ? "YES -> payout" : "NO -> refund";
  log(`=== Run: outcome ${label} ===`);
  const vault = health.vault;

  // Fresh recipients so balance checks are exact (the funder also pays gas in USDC).
  const payees = [privateKeyToAccount(generatePrivateKey()).address, privateKeyToAccount(generatePrivateKey()).address];
  const refundTo = privateKeyToAccount(generatePrivateKey()).address;
  const shares = [6000, 4000];

  // 1a. register the condition with the relay
  const condition = await api<{ conditionId: Hex }>("/api/conditions", {
    json: { source: "manual", key: `e2e-${Date.now()}-${outcome ? "yes" : "no"}`, label: `E2E ${label}` },
  });
  log(`condition ${condition.conditionId}`);

  // 1b. approve + create + fund
  const allowance = await pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: [funder.address, vault],
  });
  if (allowance < AMOUNT) {
    const tx = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [vault, AMOUNT * 100n] });
    await pub.waitForTransactionReceipt({ hash: tx });
    log(`approved vault (${tx})`);
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
  const createTx = await wallet.writeContract({
    address: vault,
    abi: verdictVaultAbi,
    functionName: "createPot",
    args: [condition.conditionId, health.resolver!, payees, shares, refundTo, deadline],
  });
  const createRcpt = await pub.waitForTransactionReceipt({ hash: createTx });
  const created = parseEventLogs({ abi: verdictVaultAbi, logs: createRcpt.logs, eventName: "PotCreated" })[0];
  if (!created) throw new Error("PotCreated not found");
  const potId = created.args.potId;
  log(`created pot #${potId}  ${EXPLORER}/tx/${createTx}`);

  const fundTx = await wallet.writeContract({ address: vault, abi: verdictVaultAbi, functionName: "fund", args: [potId, AMOUNT] });
  await pub.waitForTransactionReceipt({ hash: fundTx });
  log(`funded ${usdc(AMOUNT)}  ${EXPLORER}/tx/${fundTx}`);

  // Wait until the relay has indexed the funded pot (the GET itself nudges the relay).
  await waitFor("pot indexed", async () => {
    const d = await api<PotDetail>(`/api/pots/${potId}`).catch(() => undefined);
    return d && d.pot.total === AMOUNT.toString() ? d : undefined;
  });
  log("relay indexed the pot");

  // 2. report the result
  await api("/api/admin/outcome", { json: { conditionId: condition.conditionId, outcome }, auth: true });
  log(`reported outcome=${outcome} to relay`);

  // 3. wait for on-chain settlement through the relay
  const settled = await waitFor("relay settlement", async () => {
    const d = await api<PotDetail>(`/api/pots/${potId}`);
    if (d.relay?.last_error) log(`relay: ${d.relay.status} ${d.relay.last_error}`);
    return d.pot.status !== "open" ? d : undefined;
  });
  const onchain = await pub.readContract({ address: vault, abi: verdictVaultAbi, functionName: "getPot", args: [potId] });
  if (onchain.status !== 2 || onchain.outcome !== outcome) {
    throw new Error(`on-chain pot state mismatch: status=${onchain.status} outcome=${onchain.outcome}`);
  }
  log(`settled on-chain by relay  ${EXPLORER}/tx/${settled.relay?.tx_hash ?? "?"}`);

  const expected: { kind: string; to: Address; amount: bigint }[] = outcome
    ? [
        { kind: "payout", to: payees[0]!, amount: (AMOUNT * 6000n) / 10000n },
        { kind: "payout", to: payees[1]!, amount: AMOUNT - (AMOUNT * 6000n) / 10000n },
      ]
    : [{ kind: "refund", to: refundTo, amount: AMOUNT }];

  for (const e of expected) {
    const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [e.to] });
    if (bal !== e.amount) throw new Error(`balance of ${e.to} is ${usdc(bal)}, expected ${usdc(e.amount)}`);
    log(`on-chain ${e.kind}: ${e.to} received ${usdc(bal)}`);
  }

  // 4. the payments are visible in the ledger API used by the web app
  await waitFor("ledger entries", async () => {
    const { payments } = await api<{ payments: PotDetail["payments"] }>(`/api/payments?potId=${potId}`);
    const ok = expected.every((e) =>
      payments.some((p) => p.kind === e.kind && p.recipient === e.to.toLowerCase() && p.amount === e.amount.toString()),
    );
    return ok ? payments : undefined;
  });
  log(`ledger shows ${expected.length} payment(s) for pot #${potId}  ${API}/pots/${potId}`);
  return potId;
}

async function main() {
  log(`API ${API}`);
  const health = await waitFor("API health", () => api<Health>("/api/health"), 3000);
  if (health.chainId !== 5042002) throw new Error(`unexpected chain ${health.chainId}`);
  if (!health.resolver) throw new Error("server has no RESOLVER_PRIVATE_KEY configured");
  log(`vault ${health.vault}, resolver ${health.resolver}`);

  const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
  log(`funder ${funder.address} has ${usdc(bal)}`);

  const runs = values.outcome === "both" ? [true, false] : [values.outcome === "yes"];
  for (const o of runs) await runOnce(health, o);
  log("E2E PASSED");
}

main().catch((err) => {
  console.error(`E2E FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
