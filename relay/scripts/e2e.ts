/**
 * End-to-end runs against a deployed (or local) Verdict API on Arc testnet, with no manual steps.
 *
 * Modes (--mode, default "classic"; "all" runs every mode):
 *   classic  funder approves, creates and funds with its own transactions; outcome set by the
 *            operator (ManualSource); relay pays out / refunds.
 *   gasless  a fresh funder that NEVER sends a transaction: it signs EIP-3009 authorizations,
 *            the relay submits createPotWithAuthorization + fundWithAuthorization and pays gas
 *            in USDC. Verifies the funder's nonce is still 0 afterwards.
 *   api      an integration (API key) registers an `api` condition, reports the outcome itself
 *            via /api/v1/outcomes, and reads the pot via /api/v1; checks ownership and that an
 *            outcome cannot be flipped. Webhooks are verified if --webhook is given.
 *   multisig deploys a 2-of-3 MultisigResolver (ERC-1271) and uses it as the pot's resolver:
 *            one owner signature is rejected on-chain, two (sorted) settle the pot. Needs the
 *            Foundry build output (contracts/out).
 *
 * Every mode checks recipient balances on-chain and the payments in the ledger API.
 *
 * Usage:
 *   pnpm --filter @verdict/relay e2e -- --api https://<app>.vercel.app --mode all --outcome both
 * Env: DEPLOYER_PRIVATE_KEY (funds the runs), ADMIN_TOKEN (must match the server), ARC_RPC_URL.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  concat,
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
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { verdictVaultAbi } from "../src/abi";
import { signResolution } from "../src/signer";

// `pnpm run e2e -- --api ...` forwards the literal "--"; drop it.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    api: { type: "string", default: "http://localhost:3000" },
    mode: { type: "string", default: "classic" },
    outcome: { type: "string", default: "both" },
    amount: { type: "string", default: "0.10" },
    timeout: { type: "string", default: "180" },
    webhook: { type: "string" },
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
const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC), pollingInterval: 500 });
const wallet = createWalletClient({ account: funder, chain: arcTestnet, transport: http(RPC) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usdc = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;

type ApiInit = { json?: unknown; bearer?: string; method?: string };

async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${path} -> ${res.status} ${text}`), { status: res.status });
  return JSON.parse(text) as T;
}

async function expectStatus(status: number, p: Promise<unknown>, what: string) {
  try {
    await p;
  } catch (err) {
    if ((err as { status?: number }).status === status) return log(`ok: ${what} -> ${status}`);
    throw err;
  }
  throw new Error(`${what}: expected HTTP ${status}, got success`);
}

async function expectRejected(p: Promise<unknown>, what: string) {
  try {
    await p;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status && status >= 400) return log(`ok: ${what} rejected (${status})`);
    throw err;
  }
  throw new Error(`${what}: expected a rejection, got success`);
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
  pot: { potId: number; status: string; outcome: boolean | null; total: string; creator: string };
  payments: { kind: string; recipient: string; amount: string; txHash: string }[];
  relay: { status: string; tx_hash: string | null; last_error: string | null } | null;
  relayCost?: { totalUsdc: string; txs: { kind: string; feeUsdc: string | null; gasUsed: string | null }[] };
};
type Terms = { payees: Address[]; shares: number[]; refundTo: Address; deadline: bigint };

function newTerms(): Terms {
  return { payees: [fresh(), fresh()], shares: [6000, 4000], refundTo: fresh(), deadline: BigInt(Math.floor(Date.now() / 1000) + 15 * 60) };
}

// ------------------------------------------------------------------ funding paths

async function createClassic(health: Health, conditionId: Hex, t: Terms, resolver: Address = health.resolver!): Promise<bigint> {
  const allowance = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [funder.address, health.vault] });
  if (allowance < AMOUNT) {
    const tx = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [health.vault, AMOUNT * 100n] });
    await pub.waitForTransactionReceipt({ hash: tx });
    log(`approved vault (${tx})`);
  }
  const createTx = await wallet.writeContract({
    address: health.vault,
    abi: verdictVaultAbi,
    functionName: "createPot",
    args: [conditionId, resolver, t.payees, t.shares, t.refundTo, t.deadline],
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash: createTx });
  const created = parseEventLogs({ abi: verdictVaultAbi, logs: rcpt.logs, eventName: "PotCreated" })[0];
  if (!created) throw new Error("PotCreated not found");
  log(`created pot #${created.args.potId}  ${EXPLORER}/tx/${createTx}`);
  const fundTx = await wallet.writeContract({ address: health.vault, abi: verdictVaultAbi, functionName: "fund", args: [created.args.potId, AMOUNT] });
  await pub.waitForTransactionReceipt({ hash: fundTx });
  log(`funded ${usdc(AMOUNT)}  ${EXPLORER}/tx/${fundTx}`);
  return created.args.potId;
}

const authorizationStateAbi = [
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

type Prepared = {
  salt: Hex;
  nonce: Hex;
  validAfter: string;
  validBefore: string;
  typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, string> };
};

async function signPrepared(signer: PrivateKeyAccount, p: Prepared) {
  const m = p.typedData.message;
  const signature = await signer.signTypedData({
    domain: { ...p.typedData.domain, chainId: Number(p.typedData.domain.chainId) },
    types: p.typedData.types,
    primaryType: p.typedData.primaryType,
    message: { ...m, value: BigInt(m.value!), validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) },
  } as unknown as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
  return { from: signer.address, validAfter: p.validAfter, validBefore: p.validBefore, salt: p.salt, signature };
}

/** A funder with USDC but no transactions of its own: signs, the relay submits. */
async function createGasless(health: Health, conditionId: Hex, t: Terms, bearer?: string): Promise<{ potId: bigint; total: bigint }> {
  const signer = privateKeyToAccount(generatePrivateKey());
  const topUp = AMOUNT;
  const tx = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [signer.address, AMOUNT + topUp] });
  await pub.waitForTransactionReceipt({ hash: tx });
  log(`gasless funder ${signer.address} received ${usdc(AMOUNT + topUp)} (it will not send any transaction)`);

  const params = {
    conditionId,
    resolver: health.resolver!,
    payees: t.payees,
    sharesBps: t.shares,
    refundTo: t.refundTo,
    deadline: t.deadline.toString(),
  };
  const prepCreate = await api<Prepared>("/api/gasless/prepare", {
    json: { kind: "create", params, from: signer.address, amount: AMOUNT.toString() },
  });
  const created = await api<{ tx: Hex; potId: string }>("/api/gasless/create", {
    json: { params, amount: AMOUNT.toString(), authorization: await signPrepared(signer, prepCreate) },
    bearer,
  });
  log(`relay created + funded pot #${created.potId} from a signature  ${EXPLORER}/tx/${created.tx}`);
  const potId = BigInt(created.potId);

  const prepFund = await api<Prepared>("/api/gasless/prepare", {
    json: { kind: "fund", potId: potId.toString(), from: signer.address, amount: topUp.toString() },
  });
  const auth = await signPrepared(signer, prepFund);
  const funded = await api<{ tx: Hex }>("/api/gasless/fund", { json: { potId: potId.toString(), amount: topUp.toString(), authorization: auth }, bearer });
  log(`relay topped up ${usdc(topUp)} from a second signature  ${EXPLORER}/tx/${funded.tx}`);

  // The same authorization cannot be used twice: Arc USDC marks the EIP-3009 nonce as used.
  const used = await pub.readContract({
    address: USDC,
    abi: authorizationStateAbi,
    functionName: "authorizationState",
    args: [signer.address, prepFund.nonce],
  });
  if (!used) throw new Error("authorization nonce not marked as used on-chain");
  await expectRejected(api("/api/gasless/fund", { json: { potId: potId.toString(), amount: topUp.toString(), authorization: auth }, bearer }), "replayed authorization");

  const nonce = await pub.getTransactionCount({ address: signer.address });
  if (nonce !== 0) throw new Error(`gasless funder sent ${nonce} transaction(s)`);
  log("gasless funder nonce is still 0");
  const onchain = await pub.readContract({ address: health.vault, abi: verdictVaultAbi, functionName: "getPot", args: [potId] });
  if (onchain.total !== AMOUNT + topUp) throw new Error(`pot total ${onchain.total}, expected ${AMOUNT + topUp}`);
  return { potId, total: AMOUNT + topUp };
}

// ------------------------------------------------------------------ settlement checks

async function waitIndexed(potId: bigint, total: bigint, bearer?: string) {
  const path = bearer ? `/api/v1/pots/${potId}` : `/api/pots/${potId}`;
  await waitFor("pot indexed", async () => {
    const d = await api<PotDetail>(path, { bearer }).catch(() => undefined);
    return d && d.pot.total === total.toString() ? d : undefined;
  });
  log("relay indexed the pot");
}

async function verifySettlement(health: Health, potId: bigint, total: bigint, outcome: boolean, t: Terms) {
  const settled = await waitFor("relay settlement", async () => {
    const d = await api<PotDetail>(`/api/pots/${potId}`);
    if (d.relay?.last_error) log(`relay: ${d.relay.status} ${d.relay.last_error}`);
    return d.pot.status !== "open" ? d : undefined;
  });
  const onchain = await pub.readContract({ address: health.vault, abi: verdictVaultAbi, functionName: "getPot", args: [potId] });
  if (onchain.status !== 2 || onchain.outcome !== outcome) {
    throw new Error(`on-chain pot state mismatch: status=${onchain.status} outcome=${onchain.outcome}`);
  }
  log(settled.relay?.tx_hash ? `settled on-chain by relay  ${EXPLORER}/tx/${settled.relay.tx_hash}` : "settled on-chain (indexed by relay)");

  const first = (total * 6000n) / 10000n;
  const expected = outcome
    ? [
        { kind: "payout", to: t.payees[0]!, amount: first },
        { kind: "payout", to: t.payees[1]!, amount: total - first },
      ]
    : [{ kind: "refund", to: t.refundTo, amount: total }];
  for (const e of expected) {
    const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [e.to] });
    if (bal !== e.amount) throw new Error(`balance of ${e.to} is ${usdc(bal)}, expected ${usdc(e.amount)}`);
    log(`on-chain ${e.kind}: ${e.to} received ${usdc(bal)}`);
  }
  await waitFor("ledger entries", async () => {
    const { payments } = await api<{ payments: PotDetail["payments"] }>(`/api/payments?potId=${potId}`);
    const ok = expected.every((e) => payments.some((p) => p.kind === e.kind && p.recipient === e.to.toLowerCase() && p.amount === e.amount.toString()));
    return ok ? payments : undefined;
  });
  const detail = await api<PotDetail>(`/api/pots/${potId}`);
  const cost = detail.relayCost;
  if (cost?.txs.length) log(`relay gas for this pot: ${usdc(BigInt(cost.totalUsdc))} over ${cost.txs.length} tx (${cost.txs.map((x) => x.kind).join(", ")})`);
  log(`ledger shows ${expected.length} payment(s) for pot #${potId}  ${API}/pots/${potId}`);
}

// ------------------------------------------------------------------ modes

async function runClassic(health: Health, outcome: boolean) {
  log(`=== classic: outcome ${outcome ? "YES -> payout" : "NO -> refund"} ===`);
  const t = newTerms();
  const condition = await api<{ conditionId: Hex }>("/api/conditions", {
    json: { source: "manual", key: `e2e-${Date.now()}-${outcome}`, label: `E2E classic ${outcome}` },
  });
  const potId = await createClassic(health, condition.conditionId, t);
  await waitIndexed(potId, AMOUNT);
  await api("/api/admin/outcome", { json: { conditionId: condition.conditionId, outcome }, bearer: adminToken });
  log(`operator reported outcome=${outcome}`);
  await verifySettlement(health, potId, AMOUNT, outcome, t);
}

async function runGasless(health: Health, outcome: boolean) {
  log(`=== gasless: outcome ${outcome ? "YES -> payout" : "NO -> refund"} ===`);
  const t = newTerms();
  const condition = await api<{ conditionId: Hex }>("/api/conditions", {
    json: { source: "manual", key: `e2e-gasless-${Date.now()}-${outcome}`, label: `E2E gasless ${outcome}` },
  });
  const { potId, total } = await createGasless(health, condition.conditionId, t);
  await waitIndexed(potId, total);
  await api("/api/admin/outcome", { json: { conditionId: condition.conditionId, outcome }, bearer: adminToken });
  log(`operator reported outcome=${outcome}`);
  await verifySettlement(health, potId, total, outcome, t);
}

async function runApi(health: Health, outcome: boolean) {
  log(`=== integration api: outcome ${outcome ? "YES -> payout" : "NO -> refund"} ===`);
  const app = await api<{ integration: { id: string }; apiKey: string; webhookSecret: string }>("/api/admin/integrations", {
    json: { name: `e2e-${Date.now()}`, webhookUrl: values.webhook ?? null },
    bearer: adminToken,
  });
  const other = await api<{ integration: { id: string }; apiKey: string }>("/api/admin/integrations", {
    json: { name: `e2e-other-${Date.now()}` },
    bearer: adminToken,
  });
  log(`integration ${app.integration.id} created (API key shown once)`);
  try {
    const me = await api<{ vault: Address; resolver: Address }>("/api/v1/me", { bearer: app.apiKey });
    if (getAddress(me.vault) !== getAddress(health.vault)) throw new Error("/api/v1/me returned another vault");

    await expectStatus(401, api("/api/conditions", { json: { source: "api", key: "no-key" } }), "api condition without key");
    const t = newTerms();
    const cond = await api<{ conditionId: Hex; owner: string }>("/api/v1/conditions", {
      json: { source: "api", key: `order-${Date.now()}`, label: "E2E: order delivered" },
      bearer: app.apiKey,
    });
    if (cond.owner !== app.integration.id) throw new Error("condition owner mismatch");
    log(`api condition ${cond.conditionId}`);

    const { potId, total } = await createGasless(health, cond.conditionId, t, app.apiKey);
    await waitIndexed(potId, total, app.apiKey);

    await expectStatus(403, api("/api/v1/outcomes", { json: { conditionId: cond.conditionId, outcome }, bearer: other.apiKey }), "outcome from a foreign integration");
    await api("/api/v1/outcomes", { json: { conditionId: cond.conditionId, outcome }, bearer: app.apiKey });
    log(`integration reported outcome=${outcome}`);
    await expectStatus(409, api("/api/v1/outcomes", { json: { conditionId: cond.conditionId, outcome: !outcome }, bearer: app.apiKey }), "flipping a reported outcome");

    await verifySettlement(health, potId, total, outcome, t);

    const { deliveries } = await api<{ deliveries: { event_type: string; delivered_at: string | null; last_error: string | null }[] }>(
      "/api/v1/deliveries",
      { bearer: app.apiKey },
    );
    const types = new Set(deliveries.map((d) => d.event_type));
    for (const want of ["pot.created", "pot.funded", "pot.resolved"]) {
      if (!values.webhook) break;
      if (!types.has(want)) throw new Error(`no ${want} webhook queued`);
    }
    if (values.webhook) {
      await waitFor("webhooks delivered", async () => {
        const r = await api<{ deliveries: { delivered_at: string | null }[] }>("/api/v1/deliveries", { bearer: app.apiKey });
        return r.deliveries.length && r.deliveries.every((d) => d.delivered_at) ? r : undefined;
      });
      log(`webhooks delivered to ${values.webhook}: ${[...types].join(", ")}`);
    } else {
      log("no --webhook given: webhook delivery not checked");
    }
  } finally {
    for (const id of [app.integration.id, other.integration.id]) {
      await api(`/api/admin/integrations/${id}`, { method: "PATCH", json: { revoke: true }, bearer: adminToken }).catch(() => undefined);
    }
    log("integrations revoked");
  }
}

async function runMultisig(health: Health, outcome: boolean) {
  log(`=== multisig resolver (2-of-3, ERC-1271): outcome ${outcome ? "YES -> payout" : "NO -> refund"} ===`);
  const artifact = JSON.parse(
    readFileSync(new URL("../../contracts/out/MultisigResolver.sol/MultisigResolver.json", import.meta.url), "utf8"),
  ) as { abi: unknown[]; bytecode: { object: Hex } };
  const owners = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey())).sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
  const deployTx = await wallet.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.object,
    args: [owners.map((o) => o.address), 2n] as never,
  });
  const deployed = await pub.waitForTransactionReceipt({ hash: deployTx });
  const resolver = deployed.contractAddress!;
  log(`MultisigResolver ${resolver} (owners ${owners.map((o) => o.address.slice(0, 8)).join(", ")}, threshold 2)  ${EXPLORER}/tx/${deployTx}`);

  const t = newTerms();
  const condition = await api<{ conditionId: Hex }>("/api/conditions", {
    json: { source: "manual", key: `e2e-multisig-${Date.now()}-${outcome}`, label: `E2E multisig ${outcome}` },
  });
  const potId = await createClassic(health, condition.conditionId, t, resolver);
  await waitIndexed(potId, AMOUNT);

  const sig = (i: number) =>
    signResolution(owners[i]!, { chainId: 5042002, vault: health.vault, potId, conditionId: condition.conditionId, outcome });
  const one = await sig(0);
  try {
    await pub.simulateContract({ account: funder, address: health.vault, abi: verdictVaultAbi, functionName: "resolve", args: [potId, outcome, one] });
    throw new Error("a single owner signature was accepted");
  } catch (err) {
    if (!(err as Error).message.includes("InvalidSignature")) throw err;
    log("ok: one of three signatures rejected on-chain (InvalidSignature)");
  }
  const both = concat([await sig(0), await sig(2)]);
  const tx = await wallet.writeContract({ address: health.vault, abi: verdictVaultAbi, functionName: "resolve", args: [potId, outcome, both] });
  await pub.waitForTransactionReceipt({ hash: tx });
  log(`resolved with 2-of-3 owner signatures  ${EXPLORER}/tx/${tx}`);
  await verifySettlement(health, potId, AMOUNT, outcome, t);
}

async function main() {
  log(`API ${API}`);
  const health = await waitFor("API health", () => api<Health>("/api/health"), 3000);
  if (health.chainId !== 5042002) throw new Error(`unexpected chain ${health.chainId}`);
  if (!health.resolver) throw new Error("server has no RESOLVER_PRIVATE_KEY configured");
  log(`vault ${health.vault}, resolver ${health.resolver}`);

  const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
  log(`funder ${funder.address} has ${usdc(bal)}`);

  const outcomes = values.outcome === "both" ? [true, false] : [values.outcome === "yes"];
  const modes = values.mode === "all" ? ["classic", "gasless", "api", "multisig"] : [values.mode!];
  const runners: Record<string, (h: Health, o: boolean) => Promise<void>> = {
    classic: runClassic,
    gasless: runGasless,
    api: runApi,
    multisig: runMultisig,
  };
  for (const m of modes) {
    const run = runners[m];
    if (!run) throw new Error(`unknown mode ${m}`);
    for (const o of outcomes) await run(health, o);
  }

  const status = await api<{ spend: { totalUsdc: string; avgSettlementUsdc: string | null; runwaySettlements: string | null }; balance: { usdc: string; consistent: boolean } }>(
    "/api/status",
  );
  log(
    `relay: balance ${usdc(BigInt(status.balance.usdc))} (native/ERC-20 consistent: ${status.balance.consistent}), ` +
      `spent ${usdc(BigInt(status.spend.totalUsdc))}, avg settlement ${status.spend.avgSettlementUsdc ? usdc(BigInt(status.spend.avgSettlementUsdc)) : "-"}, ` +
      `runway ${status.spend.runwaySettlements ?? "-"} settlements`,
  );
  log("E2E PASSED");
}

main().catch((err) => {
  console.error(`E2E FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
