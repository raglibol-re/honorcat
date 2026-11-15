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
 *   guarantees  Verdict Guarantees on live Gemini markets: on a 5-minute demo market, two
 *            guarantees (refund on YES / refund on NO), 3 customers each, settle, verify refunds,
 *            memos and a gasless withdrawal; for the other templates create, fund and enrol.
 *   passkey  registers a passkey (software authenticator), joins a guarantee with it, and withdraws
 *            from the counterfactual account: the relay deploys it and WebAuthn is verified on Arc.
 *   early    HonorCat early payouts on the live Gemini contracts best suited right now: one pot
 *            that triggers (two of three samplers sign evidence; recipients paid before the
 *            event) and one that closes without crossing (funder refunded); 3 recipients each.
 *            Runs the local sampler in-process (SAMPLER_KEY_LOCAL). E2E_EARLY_RUNS=2 repeats it.
 *   drops    MerkleBook payouts: two drops of 250 payees on a live 5-minute market (pay on YES /
 *            NO), list replaced before lock, inclusion proofs via the API, the relay pushes every
 *            claim in batches; every payee balance and the funder's return are checked on-chain.
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
import { createHash } from "node:crypto";
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
  keccak256,
  parseEventLogs,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { verdictVaultAbi } from "../src/abi";
import { signResolution } from "../src/signer";
import { passkeyFactoryAbi } from "../src/passkeys";
import { softPasskey } from "../src/softPasskey";
import { httpIo, Sampler, WsBookSource } from "../src/sampler";
import * as trigger from "../src/trigger";

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

// ------------------------------------------------------------------ Verdict Guarantees

type MarketsResponse = {
  markets: { ticker: string; title: string; expiry: string; contracts: { ticker: string; label: string; chanceYes: number | null }[] }[];
};
type PreparedGuarantee = Prepared & { terms: Record<string, unknown> & { promise: string; lockTime: number; settlesAt: number }; seal: string; amount: string };
type GuaranteeDetailResponse = {
  guarantee: { id: string; potId: number | null; gid: number | null; promise: string; side: string; refund: string; status: string };
  customers: { account: string; seat: number; refund: { tx: string } | null }[];
  memos: { txHash: string; text: string | null; body: Record<string, unknown> | null }[];
  resolution: { signature: string | null; reason: string | null; signedPayload: unknown } | null;
  verdict: { resultToPaymentMs: number | null; broadcastToReceiptMs: number | null; refundTx: string | null } | null;
  onchain: { potStatus: string; potOutcome: boolean; potTotal: string; enrolled: number | null; refundsSettled: boolean | null } | null;
  market: { chanceOfRefund: number | null; status: string | null; resolutionSide: string | null } | null;
  events: { name: string; contract: string; firstSeenVia: string }[];
};

const REFUND = 100_000n; // 0.10 USDC per customer
const SEATS = 3;

async function createGuaranteeViaApi(template: string, market: MarketsResponse["markets"][number], contractTicker: string, side: "yes" | "no") {
  const prep = await api<PreparedGuarantee>("/api/guarantees/prepare", {
    json: {
      template,
      eventTicker: market.ticker,
      contractTicker,
      side,
      merchantName: `E2E ${template} merchant`,
      merchant: funder.address,
      refund: (Number(REFUND) / 1e6).toFixed(2),
      maxCustomers: SEATS,
      listed: false, // test run: real Gemini market, but not shown in product lists
    },
  });
  const authorization = await signPrepared(funder, prep);
  const created = await api<{ id: string; potId: string; tx: Hex }>("/api/guarantees", { json: { terms: prep.terms, seal: prep.seal, authorization } });
  log(`guarantee ${created.id} (${side}) pot #${created.potId}: "${prep.terms.promise}"  ${EXPLORER}/tx/${created.tx}`);
  return { ...created, promise: prep.terms.promise, lockTime: prep.terms.lockTime, settlesAt: prep.terms.settlesAt };
}

async function joinCustomers(id: string, n: number) {
  const customers = Array.from({ length: n }, () => privateKeyToAccount(generatePrivateKey()));
  for (const c of customers) {
    const signature = await c.signMessage({ message: `Join Verdict guarantee ${id} as ${c.address}` });
    const r = await api<{ tx?: Hex }>(`/api/guarantees/${id}/join`, { json: { account: c.address, signature } });
    log(`  customer ${c.address} joined ${id}  ${r.tx ? `${EXPLORER}/tx/${r.tx}` : ""}`);
  }
  const d = await api<GuaranteeDetailResponse>(`/api/guarantees/${id}`);
  if (d.onchain?.enrolled !== n) throw new Error(`guarantee ${id}: on-chain enrolled ${d.onchain?.enrolled}, expected ${n}`);
  return customers;
}

/**
 * Full run on a live 5-minute Gemini market: two guarantees on the same contract, one refunding
 * if it settles YES and one if it settles NO, so both outcomes are exercised by one settlement.
 */
async function runGuaranteesDemo() {
  log("=== guarantees: demo template, both outcomes on one live 5-minute market ===");
  const { markets } = await api<MarketsResponse>("/api/markets?template=demo");
  const now = Date.now();
  const market = markets.find((m) => new Date(m.expiry).getTime() > now + 150_000 && m.contracts.length);
  if (!market) throw new Error("no live 5-minute market with enough time left; try again in a minute");
  const contract = market.contracts[0]!;
  log(`market ${market.ticker} "${market.title}" contract ${contract.ticker} (${contract.label}), settles ${market.expiry}`);

  const yes = await createGuaranteeViaApi("demo", market, contract.ticker, "yes");
  const no = await createGuaranteeViaApi("demo", market, contract.ticker, "no");
  const yesCustomers = await joinCustomers(yes.id, SEATS);
  const noCustomers = await joinCustomers(no.id, SEATS);
  const merchantBefore = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });

  const waitMs = Math.max(0, yes.settlesAt * 1000 - Date.now()) + 15 * 60_000;
  log(`waiting for Gemini to settle ${market.ticker} (up to ${Math.round(waitMs / 60000)} min)…`);
  const settle = async (id: string) => {
    const until = Date.now() + waitMs;
    for (;;) {
      const d = await api<GuaranteeDetailResponse>(`/api/guarantees/${id}`).catch(() => null);
      if (d?.onchain && d.onchain.potStatus !== "open" && (d.onchain.potOutcome === false || d.onchain.refundsSettled)) return d;
      if (Date.now() > until) throw new Error(`guarantee ${id} not settled in time (market ${d?.market?.status ?? "?"})`);
      await sleep(4000);
    }
  };
  const [dy, dn] = await Promise.all([settle(yes.id), settle(no.id)]);
  const triggered = dy.onchain!.potOutcome ? { d: dy, customers: yesCustomers, other: { d: dn, customers: noCustomers } } : { d: dn, customers: noCustomers, other: { d: dy, customers: yesCustomers } };
  log(`Gemini settled ${dy.market?.resolutionSide?.toUpperCase() ?? "?"}: guarantee ${triggered.d.guarantee.id} (${triggered.d.guarantee.side}) refunds, ${triggered.other.d.guarantee.id} not triggered`);
  if (dy.onchain!.potOutcome === dn.onchain!.potOutcome) throw new Error("both guarantees resolved the same way");

  for (const c of triggered.customers) {
    const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [c.address] });
    if (bal !== REFUND) throw new Error(`customer ${c.address} has ${usdc(bal)}, expected ${usdc(REFUND)}`);
    if ((await pub.getTransactionCount({ address: c.address })) !== 0) throw new Error("customer sent a transaction");
  }
  log(`on-chain: ${SEATS} customers refunded ${usdc(REFUND)} each; none of them sent a transaction`);
  for (const c of triggered.other.customers) {
    const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [c.address] });
    if (bal !== 0n) throw new Error(`not-triggered customer ${c.address} has ${usdc(bal)}`);
  }
  const merchantAfter = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
  if (merchantAfter - merchantBefore !== REFUND * BigInt(SEATS)) {
    throw new Error(`merchant got back ${usdc(merchantAfter - merchantBefore)}, expected ${usdc(REFUND * BigInt(SEATS))}`);
  }
  log(`on-chain: merchant got the not-triggered guarantee's ${usdc(REFUND * BigInt(SEATS))} back`);

  const memoBodies = triggered.d.memos.map((m) => m.body?.t);
  if (!memoBodies.includes("fund") || !memoBodies.includes("payout") || !memoBodies.includes("refunds")) {
    throw new Error(`missing memos on the triggered guarantee: ${memoBodies.join(",")}`);
  }
  const reason = triggered.d.memos.find((m) => m.body?.t === "refunds")?.body?.why;
  log(`memo reason: ${reason}`);
  if (!triggered.other.d.memos.some((m) => m.body?.t === "refund")) throw new Error("missing refund memo on the other guarantee");
  if (!triggered.d.resolution?.signature) throw new Error("signed result not published");
  log(
    `verdict: result → payment ${triggered.d.verdict?.resultToPaymentMs ?? "?"} ms (broadcast → receipt ${triggered.d.verdict?.broadcastToReceiptMs ?? "?"} ms); refunds tx ${EXPLORER}/tx/${triggered.d.verdict?.refundTx}`,
  );
  const sameTx = triggered.d.memos.find((m) => m.body?.t === "payout")?.txHash === triggered.d.memos.find((m) => m.body?.t === "refunds")?.txHash;
  log(`resolution and customer refunds in the same transaction: ${sameTx}`);

  // gasless withdraw by one refunded customer
  const c0 = triggered.customers[0]!;
  const dest = fresh();
  const prep = await api<{ nonce: Hex; validAfter: string; validBefore: string; typedData: Prepared["typedData"] }>("/api/withdraw/prepare", {
    json: { from: c0.address, to: dest, value: REFUND.toString() },
  });
  const m = prep.typedData.message;
  const signature = await c0.signTypedData({
    domain: { ...prep.typedData.domain, chainId: Number(prep.typedData.domain.chainId) },
    types: prep.typedData.types,
    primaryType: prep.typedData.primaryType,
    message: { ...m, value: BigInt(m.value!), validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) },
  } as unknown as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
  const w = await api<{ tx: Hex }>("/api/withdraw", {
    json: { from: c0.address, to: dest, value: REFUND.toString(), validAfter: prep.validAfter, validBefore: prep.validBefore, nonce: prep.nonce, signature, guaranteeId: triggered.d.guarantee.id },
  });
  const destBal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [dest] });
  if (destBal !== REFUND) throw new Error(`withdrawal destination has ${usdc(destBal)}`);
  log(`customer withdrew ${usdc(REFUND)} to ${dest} without gas  ${EXPLORER}/tx/${w.tx}`);
  log(`cards: ${API}/g/${triggered.d.guarantee.id} (refunded), ${API}/g/${triggered.other.d.guarantee.id} (not triggered)`);
}

/** Other templates: create, fund and enrol on a live market; settlement happens when Gemini settles. */
async function runGuaranteeTemplate(template: string) {
  const { markets } = await api<MarketsResponse>(`/api/markets?template=${template}`);
  const market = markets.find((mk) => mk.contracts.some((c) => c.chanceYes !== null)) ?? markets[0];
  if (!market) {
    log(`=== guarantees: ${template}: no active market on Gemini right now, skipped ===`);
    return;
  }
  const contract = market.contracts.find((c) => c.chanceYes !== null) ?? market.contracts[0]!;
  log(`=== guarantees: ${template} on ${market.ticker}:${contract.ticker} (settles ${market.expiry}) ===`);
  const g = await createGuaranteeViaApi(template, market, contract.ticker, "yes");
  await joinCustomers(g.id, SEATS);
  log(`  ${API}/g/${g.id} is live; the relay settles it when Gemini settles the market`);
}

async function runGuarantees() {
  await runGuaranteesDemo();
  for (const t of ["rate", "temperature", "price"]) await runGuaranteeTemplate(t);
}

// ------------------------------------------------------------------ drops: Merkle payouts (Phase G)

type PreparedDrop = Prepared & { terms: { lockTime: number; deadline: number; conditionKey: string }; root: Hex; amount: string; entropy: Hex };
type DropResponse = {
  drop: { id: string; dropId: string | null; potId: string | null; entries: number; claimed: number; claimedAmount: string; potStatus: string | null; outcome: boolean | null; version: number; root: Hex; rootTotal: string };
  onchain: { root: Hex; rootTotal: string; claimed: string; version: number } | null;
};
type ProofResponse = { included: boolean; total: string; drop: { root: Hex; version: number }; entries: { index: number; amount: string; proof: Hex[]; claimedTx: string | null; claimedOnChain: boolean | null }[] };

const DROP_PAYEES = Number(process.env.E2E_DROP_PAYEES ?? 250);
const DROP_AMOUNT = 400n; // 0.0004 USDC each: 250 payees = 0.10 USDC per drop

async function createDropViaApi(market: MarketsResponse["markets"][number], contractTicker: string, side: "yes" | "no", entries: { account: Address; amount: bigint }[], lockTime: number) {
  const body = {
    name: `E2E drop (${side})`,
    funder: funder.address,
    eventTicker: market.ticker,
    contractTicker,
    side,
    lockTime,
    entries: entries.map((e) => ({ account: e.account, amount: e.amount.toString() })),
    listed: false,
  };
  const prep = await api<PreparedDrop>("/api/drops/prepare", { json: body });
  const authorization = await signPrepared(funder, prep);
  const created = await api<{ id: string; potId: string; root: Hex; total: string; tx: Hex }>("/api/drops", {
    json: { ...body, lockTime: prep.terms.lockTime, entropy: prep.entropy, authorization },
  });
  if (created.root !== prep.root) throw new Error("created root differs from the prepared root");
  log(`drop ${created.id} (${side}) pot #${created.potId}: ${entries.length} payees, ${usdc(BigInt(created.total))}, root ${created.root.slice(0, 12)}…  ${EXPLORER}/tx/${created.tx}`);

  // A tampered list with the same signature must be refused (the salt commits to the root).
  const tampered = [...body.entries];
  tampered[0] = { ...tampered[0]!, account: fresh() };
  await expectRejected(api("/api/drops", { json: { ...body, entries: tampered, lockTime: prep.terms.lockTime, entropy: prep.entropy, authorization } }), "drop with a list the funder did not sign");
  return created;
}

/** Public RPC rate-limits bursts (HTTP 429): small paced chunks, each read retried with backoff. */
async function balancesOf(accounts: Address[]) {
  const read = async (a: Address) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });
      } catch (err) {
        if (attempt >= 5) throw err;
        await sleep(500 * 2 ** attempt);
      }
    }
  };
  const out: bigint[] = [];
  for (let i = 0; i < accounts.length; i += 5) {
    out.push(...(await Promise.all(accounts.slice(i, i + 5).map(read))));
    await sleep(150);
  }
  return out;
}

/**
 * Two drops of DROP_PAYEES payees on one live 5-minute Gemini contract (pay on YES / pay on NO).
 * Before the lock the YES list is replaced (root v2, one payee swapped); proofs are checked
 * through the API. After Gemini settles, the relay pushes all claims in batches; every payee's
 * balance is checked on-chain, and the other drop's funds return to the funder.
 */
async function runDrops() {
  log(`=== drops: ${DROP_PAYEES} payees per drop, both outcomes on one live 5-minute market ===`);
  const { markets } = await api<MarketsResponse>("/api/markets?template=demo");
  const now = Date.now();
  const market = markets.find((m) => new Date(m.expiry).getTime() > now + 170_000 && m.contracts.length);
  if (!market) throw new Error("no live 5-minute market with enough time left; try again in a minute");
  const contract = market.contracts[0]!;
  const expiry = Math.floor(new Date(market.expiry).getTime() / 1000);
  const lockTime = expiry - 75;
  log(`market ${market.ticker} contract ${contract.ticker} (${contract.label}), settles ${market.expiry}`);

  const mk = () => Array.from({ length: DROP_PAYEES }, () => ({ account: fresh(), amount: DROP_AMOUNT }));
  const yesEntries = mk();
  const noEntries = mk();
  const yes = await createDropViaApi(market, contract.ticker, "yes", yesEntries, lockTime);
  const no = await createDropViaApi(market, contract.ticker, "no", noEntries, lockTime);

  // Replace the YES list before the lock: swap the last payee for a new one (same total).
  const removed = yesEntries[yesEntries.length - 1]!.account;
  yesEntries[yesEntries.length - 1] = { account: fresh(), amount: DROP_AMOUNT };
  const v2 = await api<{ root: Hex; version: number; tx: Hex }>(`/api/drops/${yes.id}/entries`, {
    method: "PUT",
    bearer: adminToken,
    json: { entries: yesEntries.map((e) => ({ account: e.account, amount: e.amount.toString() })) },
  });
  log(`list replaced before lock: root v${v2.version} ${v2.root.slice(0, 12)}…  ${EXPLORER}/tx/${v2.tx}`);
  const d1 = await api<DropResponse>(`/api/drops/${yes.id}`);
  if (d1.onchain?.root !== v2.root || d1.onchain.version !== 2) throw new Error(`on-chain root not updated: ${JSON.stringify(d1.onchain)}`);
  const pIn = await api<ProofResponse>(`/api/drops/${yes.id}/proof?account=${yesEntries[7]!.account}`);
  const pOut = await api<ProofResponse>(`/api/drops/${yes.id}/proof?account=${removed}`);
  if (!pIn.included || pIn.total !== DROP_AMOUNT.toString() || pIn.drop.version !== 2) throw new Error("inclusion check failed for a listed payee");
  if (pOut.included) throw new Error("removed payee is still on the list");
  log(`inclusion: payee on the list (proof length ${pIn.entries[0]!.proof.length}), removed payee not on it`);

  const funderBefore = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
  const waitMs = Math.max(0, expiry * 1000 - Date.now()) + 15 * 60_000;
  log(`waiting for Gemini to settle ${market.ticker} and the relay to push the claims (up to ${Math.round(waitMs / 60000)} min)…`);
  const settled = async (id: string) => {
    const until = Date.now() + waitMs;
    for (;;) {
      const d = await api<DropResponse>(`/api/drops/${id}`).catch(() => null);
      if (d?.drop.potStatus === "resolved" && (d.drop.outcome === false || d.drop.claimed === d.drop.entries)) return d;
      if (Date.now() > until) throw new Error(`drop ${id} not settled in time (${d?.drop.potStatus}, ${d?.drop.claimed}/${d?.drop.entries} paid)`);
      await sleep(4000);
    }
  };
  const [dy, dn] = await Promise.all([settled(yes.id), settled(no.id)]);
  if (dy.drop.outcome === dn.drop.outcome) throw new Error("both drops resolved the same way");
  const [paidDrop, paidEntries, otherEntries] = dy.drop.outcome ? [dy, yesEntries, noEntries] : [dn, noEntries, yesEntries];
  log(`Gemini settled: drop ${paidDrop.drop.id} pays, the other returns to the funder`);

  const paidBal = await balancesOf(paidEntries.map((e) => e.account));
  const bad = paidBal.findIndex((b) => b !== DROP_AMOUNT);
  if (bad >= 0) throw new Error(`payee ${paidEntries[bad]!.account} has ${usdc(paidBal[bad]!)}`);
  log(`on-chain: all ${paidEntries.length} payees received ${usdc(DROP_AMOUNT)}; none sent a transaction`);
  const otherBal = await balancesOf(otherEntries.slice(0, 25).map((e) => e.account));
  if (otherBal.some((b) => b !== 0n)) throw new Error("a payee of the not-triggered drop received money");
  if (dy.drop.outcome && (await balancesOf([removed]))[0] !== 0n) throw new Error("the removed payee was paid");
  const funderAfter = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
  const expectBack = DROP_AMOUNT * BigInt(DROP_PAYEES);
  if (funderAfter - funderBefore !== expectBack) throw new Error(`funder got back ${usdc(funderAfter - funderBefore)}, expected ${usdc(expectBack)}`);
  log(`on-chain: funder got the other drop's ${usdc(expectBack)} back`);
  if (paidDrop.onchain?.claimed !== paidDrop.drop.rootTotal) throw new Error(`book claimed ${paidDrop.onchain?.claimed} != ${paidDrop.drop.rootTotal}`);

  // Gas per payee from the claim transactions.
  const sample = await api<ProofResponse>(`/api/drops/${paidDrop.drop.id}/proof?account=${paidEntries[0]!.account}`);
  const tx0 = sample.entries[0]?.claimedTx;
  if (tx0?.startsWith("0x")) {
    const r = await pub.getTransactionReceipt({ hash: tx0 as Hex });
    const claims = r.logs.filter((l) => l.topics[0] === keccak256(stringToBytes("Claimed(uint256,uint256,address,uint256)"))).length;
    log(`claims tx ${EXPLORER}/tx/${tx0}: ${claims} payees, ${r.gasUsed} gas, ${claims ? Number(r.gasUsed) / claims : "?"} gas per payee`);
  }
  log(`page: ${API}/d/${paidDrop.drop.id}`);
}

// ------------------------------------------------------------------ early payouts (M4)

type DemoCandidate = { eventTicker: string; contractTicker: string; instrument: string; title: string; label: string; side: "yes" | "no"; chance: number; spread: number; closesAt: string; meetsRules: boolean };
type EarlyPrepared = Prepared & { terms: { lockTime: number; tradingClose: number; promise: string; template: string; params: { windowMs: number } }; seal: string; amount: string };
type EarlyDetailResponse = {
  early: { id: string; potId: string | null; state: string; settledKind: string | null; settledTx: string | null; evidenceRoot: string | null; lockTime: number; tradingClose: number; conditionId: Hex };
  signatures: { signer: Address; kind: string; outcome: boolean; evidenceHash: string | null; record: Record<string, unknown> | null; attestation: string | null }[];
  recipients: { account: Address }[];
  payments: { account: Address | null; amount: string; tx: string; kind: string }[];
  settledAt: string | null;
};

const EARLY_AMOUNT = 100_000n; // 0.10 USDC per recipient
const EARLY_RECIPIENTS = 3;

/** Runs the local machine's sampler inside this process (one of the three independent signers). */
function startLocalSampler() {
  const key = process.env.SAMPLER_KEY_LOCAL;
  if (!key) throw new Error("SAMPLER_KEY_LOCAL is not set");
  const source = new WsBookSource();
  const sampler = new Sampler(privateKeyToAccount(key as Hex), source, httpIo(API), pub as never, (m) => log(`  [local sampler] ${m}`));
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        await sampler.step();
      } catch (err) {
        log(`  [local sampler] step failed: ${(err as Error).message.split("\n")[0]}`);
      }
      await sleep(250);
    }
  })();
  return async () => {
    running = false;
    await loop;
    source.close();
  };
}

async function createEarlyViaApi(c: DemoCandidate, joinSeconds: number, label: string) {
  const prep = await api<EarlyPrepared>("/api/early/prepare", {
    json: {
      name: `E2E ${label}`,
      funder: funder.address,
      eventTicker: c.eventTicker,
      contractTicker: c.contractTicker,
      side: c.side,
      mode: "early-only",
      amount: (Number(EARLY_AMOUNT) / 1e6).toFixed(2),
      maxRecipients: EARLY_RECIPIENTS,
      joinSeconds,
      listed: false,
    },
  });
  const authorization = await signPrepared(funder, prep);
  const created = await api<{ id: string; potId: string; tx: Hex }>("/api/early", { json: { terms: prep.terms, seal: prep.seal, authorization } });
  log(`early payout ${created.id} (${label}) pot #${created.potId}, ${prep.terms.template} rule: "${prep.terms.promise}"  ${EXPLORER}/tx/${created.tx}`);
  return { ...created, lockTime: prep.terms.lockTime, tradingClose: prep.terms.tradingClose };
}

async function joinEarlyRecipients(id: string) {
  const people = Array.from({ length: EARLY_RECIPIENTS }, () => privateKeyToAccount(generatePrivateKey()));
  for (const p of people) {
    const signature = await p.signMessage({ message: `Join HonorCat early payout ${id} as ${p.address}` });
    await api(`/api/early/${id}/join`, { json: { account: p.address, signature } });
  }
  log(`  ${EARLY_RECIPIENTS} recipients joined ${id}`);
  return people;
}

async function waitEarly(id: string, until: number, done: (d: EarlyDetailResponse) => boolean, what: string) {
  for (;;) {
    const d = await api<EarlyDetailResponse>(`/api/early/${id}`).catch(() => null);
    if (d && done(d)) return d;
    if (Date.now() > until) throw new Error(`${what}: timed out (state ${d?.early.state}, signatures ${d?.signatures.map((s) => `${s.kind}:${s.signer.slice(0, 6)}`).join(",")})`);
    await sleep(3000);
  }
}

/**
 * One early payout and one refund, three recipients each, on the live Gemini contracts best
 * suited right now (/api/early/demo). The local sampler runs in this process; the Vercel app
 * samples in bursts while the run polls; the GitHub Actions sampler joins if dispatched.
 * Checks on-chain balances, the 2-of-3 signatures, the evidence (recomputed here) and the memo root.
 */
async function runEarly() {
  log("=== early payouts: one trigger, one refund, 3 recipients each ===");
  const demo = await api<{ trigger: DemoCandidate[]; refund: DemoCandidate[] }>("/api/early/demo");
  const t = demo.trigger[0];
  const r = demo.refund[0];
  if (!t) throw new Error("no live Gemini contract meets the demo trigger rules right now");
  if (!r) throw new Error("no live Gemini contract suitable for the refund run");
  log(`trigger market: ${t.title} — ${t.label} (${t.side.toUpperCase()} at ${(t.chance * 100).toFixed(1)}%, spread ${t.spread.toFixed(2)}), closes ${t.closesAt}`);
  log(`refund market:  ${r.title} — ${r.label} (${r.side.toUpperCase()} at ${(r.chance * 100).toFixed(1)}%), closes ${r.closesAt}`);

  // E2E_EXTERNAL_LOCAL_SAMPLER=1: the local sampler already runs as its own process (pnpm sampler).
  const stop = process.env.E2E_EXTERNAL_LOCAL_SAMPLER === "1" ? async () => {} : startLocalSampler();
  try {
    const before = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
    const a = await createEarlyViaApi(t, 40, "early payout");
    const b = await createEarlyViaApi(r, 30, "refund");
    const pa = await joinEarlyRecipients(a.id);
    const pb = await joinEarlyRecipients(b.id);

    const da = await waitEarly(a.id, Date.now() + 12 * 60_000, (d) => d.early.state === "paid", `early payout ${a.id}`);
    const lead = Math.round((da.early.tradingClose * 1000 - new Date(da.settledAt ?? Date.now()).getTime()) / 60_000);
    log(`PAID EARLY: ${a.id} settled ${da.early.settledKind} ${EXPLORER}/tx/${da.early.settledTx} (${lead} min before trading closes)`);
    for (const p of pa) {
      const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [p.address] });
      if (bal !== EARLY_AMOUNT) throw new Error(`recipient ${p.address} has ${usdc(bal)}, expected ${usdc(EARLY_AMOUNT)}`);
      if ((await pub.getTransactionCount({ address: p.address })) !== 0) throw new Error("a recipient sent a transaction");
    }
    log(`on-chain: ${EARLY_RECIPIENTS} recipients received ${usdc(EARLY_AMOUNT)} each; none sent a transaction`);

    // Evidence: every trigger record recomputes to its decision; the memo root matches.
    const triggers = da.signatures.filter((s) => s.kind === "trigger");
    if (triggers.length < 2) throw new Error(`expected 2 trigger signatures, got ${triggers.length}`);
    const recs = triggers.map((s) => trigger.recordFromJson(s.record!));
    for (const rec of recs) {
      const d = trigger.verifyRecord(rec);
      if (!d.triggered || trigger.evidenceHash(rec) !== triggers.find((s) => s.signer === rec.signer)!.evidenceHash) throw new Error("evidence does not recompute");
    }
    const ordered = [...recs].sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1)).slice(0, 2);
    const root = trigger.evidenceRootOf(ordered.map((x) => trigger.evidenceHash(x)));
    if (root !== da.early.evidenceRoot) throw new Error(`evidence root ${root} != published ${da.early.evidenceRoot}`);
    log(`evidence: ${recs.length} signer records recompute; evidenceRoot ${root.slice(0, 14)}… matches the payout memo; signers ${recs.map((x) => x.signer.slice(0, 8)).join(", ")}`);

    const waitB = Math.max(0, b.tradingClose * 1000 - Date.now()) + 6 * 60_000;
    log(`waiting for ${b.id} to close without crossing (up to ${Math.round(waitB / 60_000)} min)…`);
    const db_ = await waitEarly(b.id, Date.now() + waitB, (d) => d.early.state === "refunded", `refund ${b.id}`);
    log(`REFUNDED: ${b.id} settled ${db_.early.settledKind} ${EXPLORER}/tx/${db_.early.settledTx}`);
    for (const p of pb) {
      const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [p.address] });
      if (bal !== 0n) throw new Error(`refund-run recipient ${p.address} received ${usdc(bal)}`);
    }
    const after = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
    const spent = before - after;
    const expected = EARLY_AMOUNT * BigInt(EARLY_RECIPIENTS); // run A paid out; run B came back in full
    if (spent !== expected) throw new Error(`funder spent ${usdc(spent)}, expected ${usdc(expected)}`);
    log(`on-chain: refund-run recipients got nothing; the funder got ${usdc(EARLY_AMOUNT * BigInt(EARLY_RECIPIENTS))} back`);
    log(`pages: ${API}/e/${a.id} (paid early), ${API}/e/${b.id} (refunded)`);
  } finally {
    await stop();
  }
}

// ------------------------------------------------------------------ passkey accounts (Phase B)

/**
 * A software authenticator stands in for the user's device: register a passkey, join an
 * (unlisted) guarantee with a passkey signature, receive USDC on the not-yet-deployed account,
 * then withdraw it: the relay deploys the account and runs PasskeyAccount.execute, whose WebAuthn
 * signature is verified on Arc through the P-256 precompile. A replay must be rejected.
 */
async function runPasskey() {
  log("=== passkey account: register, join, withdraw (relay pays gas) ===");
  const rpId = new URL(API).hostname;
  const pk = await softPasskey(rpId);
  const reg = await api<{ account: Address }>("/api/passkeys/register", { json: { credentialId: pk.credentialId, qx: pk.qx, qy: pk.qy } });
  const factoryAddr = getAddress(
    (JSON.parse(readFileSync(new URL("../../deployments/5042002.passkeys.json", import.meta.url), "utf8")) as { passkeyAccountFactory: string }).passkeyAccountFactory,
  );
  const onchain = await pub.readContract({
    address: factoryAddr,
    abi: passkeyFactoryAbi,
    functionName: "accountAddress",
    args: [pk.qx, pk.qy, keccakFreeSha256(rpId)],
  });
  if (getAddress(onchain) !== getAddress(reg.account)) throw new Error("account address does not match the factory");
  log(`passkey account ${reg.account} (not deployed yet)`);

  // join an unlisted guarantee that is still open
  const open = process.env.E2E_OPEN_GUARANTEE ?? (await findOpenUnlistedGuarantee());
  const message = `Join Verdict guarantee ${open} as ${reg.account}`;
  const assertion = await pk.sign(keccak256(stringToBytes(message)));
  const joined = await api<{ tx?: Hex }>(`/api/guarantees/${open}/join`, { json: { account: reg.account, passkey: assertion } });
  log(`joined guarantee ${open} with a passkey signature  ${joined.tx ? `${EXPLORER}/tx/${joined.tx}` : ""}`);
  await expectRejected(
    api(`/api/guarantees/${open}/join`, { json: { account: reg.account, passkey: { ...assertion, s: assertion.r } } }),
    "join with a corrupted passkey signature",
  );

  // fund the counterfactual account, then withdraw through the passkey
  const amount = 20_000n; // 0.02 USDC
  const fundTx = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [reg.account, amount] });
  await pub.waitForTransactionReceipt({ hash: fundTx });
  const dest = fresh();
  const prep = await api<{ challenge: Hex; deadline: string }>("/api/passkeys/withdraw/prepare", {
    json: { account: reg.account, to: dest, value: amount.toString() },
  });
  const wAssertion = await pk.sign(prep.challenge);
  const w = await api<{ tx: Hex }>("/api/passkeys/withdraw", {
    json: { account: reg.account, to: dest, value: amount.toString(), deadline: prep.deadline, assertion: wAssertion },
  });
  const rc = await pub.waitForTransactionReceipt({ hash: w.tx });
  const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [dest] });
  if (bal !== amount) throw new Error(`destination got ${usdc(bal)}, expected ${usdc(amount)}`);
  const code = await pub.getCode({ address: reg.account });
  if (!code || code === "0x") throw new Error("passkey account was not deployed");
  log(`withdrew ${usdc(amount)} with the passkey; account deployed and WebAuthn verified on Arc in one tx (${rc.gasUsed} gas)  ${EXPLORER}/tx/${w.tx}`);
  await expectRejected(
    api("/api/passkeys/withdraw", { json: { account: reg.account, to: dest, value: amount.toString(), deadline: prep.deadline, assertion: wAssertion } }),
    "replayed passkey withdrawal",
  );
}

/** sha256(rpId) as hex, matching the contract's rpIdHash. */
function keccakFreeSha256(s: string): Hex {
  return `0x${createHash("sha256").update(s).digest("hex")}`;
}

async function findOpenUnlistedGuarantee(): Promise<string> {
  // unlisted test guarantees are not in /api/guarantees; use the known open test guarantee ids
  for (const id of ["KHb_jO6rDa", "1tDGd9vAy_"]) {
    const d = await api<{ guarantee: { lockTime: number; maxCustomers: number }; customers: unknown[] }>(`/api/guarantees/${id}`).catch(() => null);
    if (d && d.guarantee.lockTime > Date.now() / 1000 + 60 && d.customers.length < d.guarantee.maxCustomers) return id;
  }
  throw new Error("no open unlisted guarantee to join; set E2E_OPEN_GUARANTEE");
}

async function main() {
  log(`API ${API}`);
  const health = await waitFor("API health", () => api<Health>("/api/health"), 3000);
  if (health.chainId !== 5042002) throw new Error(`unexpected chain ${health.chainId}`);
  if (!health.resolver) throw new Error("server has no RESOLVER_PRIVATE_KEY configured");
  log(`vault ${health.vault}, resolver ${health.resolver}`);

  const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
  log(`funder ${funder.address} has ${usdc(bal)}`);

  if (values.mode === "passkey") {
    await runPasskey();
    log("E2E PASSED");
    return;
  }
  if (values.mode === "early") {
    const runs = Number(process.env.E2E_EARLY_RUNS ?? 1);
    for (let i = 1; i <= runs; i++) {
      if (runs > 1) log(`--- early run ${i} of ${runs} ---`);
      await runEarly();
    }
    log("E2E PASSED");
    return;
  }
  if (values.mode === "drops") {
    await runDrops();
    log("E2E PASSED");
    return;
  }
  if (values.mode === "guarantees") {
    await runGuarantees();
    log("E2E PASSED");
    return;
  }
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
