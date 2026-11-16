import { randomBytes } from "node:crypto";
import { encodeFunctionData, getAddress, pad, parseAbi, type Address, type Hex } from "viem";
import type { Db } from "./db";
import { sendRelayCalls } from "./txs";

/**
 * Circle Gateway: one USDC balance across chains. A user deposits USDC into the GatewayWallet on
 * any supported chain; to spend it on Arc they sign a BurnIntent, Circle's Gateway API answers with
 * an attestation, and anyone (HonorCat's relay) calls GatewayMinter.gatewayMint on Arc, which mints
 * the USDC to the recipient. Arc as source or destination has no transfer fee.
 * Source: developers.circle.com/gateway (contract addresses, BurnIntent, API).
 */
export const GATEWAY_WALLET: Address = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const GATEWAY_MINTER: Address = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
export const GATEWAY_API = "https://gateway-api-testnet.circle.com";
export const ARC_DOMAIN = 26;

/** Testnet chains Gateway supports for EVM deposits, with their USDC (same as CCTP). */
export const GATEWAY_SOURCES: { domain: number; chainId: number; name: string; usdc: Address; finality: string }[] = [
  { domain: 26, chainId: 5042002, name: "Arc Testnet", usdc: "0x3600000000000000000000000000000000000000", finality: "about a second" },
  { domain: 1, chainId: 43113, name: "Avalanche Fuji", usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", finality: "about 8 seconds" },
  { domain: 6, chainId: 84532, name: "Base Sepolia", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", finality: "13 to 19 minutes" },
  { domain: 0, chainId: 11155111, name: "Ethereum Sepolia", usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", finality: "13 to 19 minutes" },
  { domain: 3, chainId: 421614, name: "Arbitrum Sepolia", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", finality: "13 to 19 minutes" },
  { domain: 2, chainId: 11155420, name: "OP Sepolia", usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", finality: "13 to 19 minutes" },
  { domain: 7, chainId: 80002, name: "Polygon Amoy", usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", finality: "a few minutes" },
];

export const gatewayWalletAbi = parseAbi(["function deposit(address token, uint256 value)"]);
export const gatewayMinterAbi = parseAbi(["function gatewayMint(bytes attestationPayload, bytes signature)"]);

export const burnIntentTypes = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;
export const burnIntentDomain = { name: "GatewayWallet", version: "1" } as const;

export type BurnIntent = {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: Hex;
    destinationContract: Hex;
    sourceToken: Hex;
    destinationToken: Hex;
    sourceDepositor: Hex;
    destinationRecipient: Hex;
    sourceSigner: Hex;
    destinationCaller: Hex;
    value: bigint;
    salt: Hex;
    hookData: Hex;
  };
};

const b32 = (a: Address) => pad(getAddress(a), { size: 32 }).toLowerCase() as Hex;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;

/** A BurnIntent moving `value` from a depositor's Gateway balance on `sourceDomain` to `recipient` on Arc. */
export function burnIntent(input: { sourceDomain: number; depositor: Address; recipient: Address; value: bigint; maxFee: bigint; salt: Hex; signer?: Address }): BurnIntent {
  const src = GATEWAY_SOURCES.find((s) => s.domain === input.sourceDomain);
  if (!src) throw new Error(`Gateway domain ${input.sourceDomain} is not supported here`);
  return {
    maxBlockHeight: 2n ** 256n - 1n,
    maxFee: input.maxFee,
    spec: {
      version: 1,
      sourceDomain: input.sourceDomain,
      destinationDomain: ARC_DOMAIN,
      sourceContract: b32(GATEWAY_WALLET),
      destinationContract: b32(GATEWAY_MINTER),
      sourceToken: b32(src.usdc),
      destinationToken: b32("0x3600000000000000000000000000000000000000"),
      sourceDepositor: b32(input.depositor),
      destinationRecipient: b32(input.recipient),
      sourceSigner: b32(input.signer ?? input.depositor),
      destinationCaller: ZERO32,
      value: input.value,
      salt: input.salt,
      hookData: "0x",
    },
  };
}

const jsonBig = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function api<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(GATEWAY_API + path, { method: "POST", headers: { "content-type": "application/json" }, body: jsonBig(body), signal: AbortSignal.timeout(20_000) });
  const t = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Gateway ${path}: ${r.status} ${t.slice(0, 300)}`), { status: r.status >= 500 ? 502 : 400 });
  return JSON.parse(t) as T;
}

/** A depositor's Gateway USDC balance per supported chain (finalized deposits only). */
export async function gatewayBalances(depositor: Address) {
  const r = await api<{ balances: { domain: number; depositor: string; balance: string }[] }>("/v1/balances", {
    token: "USDC",
    sources: GATEWAY_SOURCES.map((s) => ({ domain: s.domain, depositor: getAddress(depositor) })),
  });
  return r.balances.map((b) => ({ ...b, name: GATEWAY_SOURCES.find((s) => s.domain === b.domain)?.name ?? `domain ${b.domain}` }));
}

/** Circle's attestation for a signed BurnIntent (to be minted on Arc). */
export async function gatewayAttest(intent: BurnIntent, signature: Hex) {
  const r = await api<{ attestation: Hex; signature: Hex } | { attestation: Hex; signature: Hex }[]>("/v1/transfer", [{ burnIntent: intent, signature }]);
  const a = Array.isArray(r) ? r[0]! : r;
  if (!a?.attestation || !a?.signature) throw new Error("Gateway returned no attestation");
  return a;
}

/* ------------------------------------------------------------------ HonorCat's use */

const MAX_MOVE = 50_000_000n; // testnet: at most $50 per move

const strIntent = (b: BurnIntent) => JSON.parse(jsonBig(b)) as Record<string, unknown>;
function fromJson(j: Record<string, unknown>): BurnIntent {
  const s = j.spec as Record<string, unknown>;
  return {
    maxBlockHeight: BigInt(String(j.maxBlockHeight)),
    maxFee: BigInt(String(j.maxFee)),
    spec: {
      version: Number(s.version),
      sourceDomain: Number(s.sourceDomain),
      destinationDomain: Number(s.destinationDomain),
      sourceContract: String(s.sourceContract).toLowerCase() as Hex,
      destinationContract: String(s.destinationContract).toLowerCase() as Hex,
      sourceToken: String(s.sourceToken).toLowerCase() as Hex,
      destinationToken: String(s.destinationToken).toLowerCase() as Hex,
      sourceDepositor: String(s.sourceDepositor).toLowerCase() as Hex,
      destinationRecipient: String(s.destinationRecipient).toLowerCase() as Hex,
      sourceSigner: String(s.sourceSigner).toLowerCase() as Hex,
      destinationCaller: String(s.destinationCaller).toLowerCase() as Hex,
      value: BigInt(String(s.value)),
      salt: String(s.salt) as Hex,
      hookData: String(s.hookData ?? "0x") as Hex,
    },
  };
}

/**
 * The BurnIntent a depositor should sign to move `value` from their Gateway balance on
 * `sourceDomain` to `recipient` on Arc, with the fee cap and expiry from Circle's estimate.
 */
export async function prepareGatewayMove(input: { sourceDomain: number; depositor: Address; recipient: Address; value: bigint }) {
  if (input.value <= 0n || input.value > MAX_MOVE) throw Object.assign(new Error("move between $0.01 and $50"), { status: 400 });
  const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
  const { spec } = burnIntent({ ...input, maxFee: 0n, salt });
  const est = await api<{ burnIntent: Record<string, unknown> }[]>("/v1/estimate", [{ spec }]);
  const intent = fromJson(est[0]!.burnIntent);
  if (intent.spec.salt.toLowerCase() !== salt.toLowerCase() || intent.spec.value !== input.value) throw new Error("Gateway changed the intent");
  return { burnIntent: strIntent(intent), fee: intent.maxFee.toString(), domain: burnIntentDomain };
}

/**
 * Takes a signed BurnIntent, gets Circle's attestation and mints on Arc from HonorCat's relay
 * (the Circle wallet). Only transfers into Arc USDC through the GatewayMinter are accepted.
 */
export async function completeGatewayMove(db: Db, input: { burnIntent: Record<string, unknown>; signature: Hex }) {
  const intent = fromJson(input.burnIntent);
  const s = intent.spec;
  if (s.destinationDomain !== ARC_DOMAIN || s.destinationContract !== b32(GATEWAY_MINTER) || s.destinationToken !== b32("0x3600000000000000000000000000000000000000"))
    throw Object.assign(new Error("only moves into USDC on Arc"), { status: 400 });
  if (s.value <= 0n || s.value > MAX_MOVE) throw Object.assign(new Error("move between $0.01 and $50"), { status: 400 });
  const att = await gatewayAttest(intent, input.signature);
  const data = encodeFunctionData({ abi: gatewayMinterAbi, functionName: "gatewayMint", args: [att.attestation, att.signature] });
  const res = await sendRelayCalls(db, "pot_gateway", [{ target: GATEWAY_MINTER, callData: data, label: "gateway mint" }]);
  if (!res.ok) throw Object.assign(new Error(`minting on Arc failed: ${res.error.slice(0, 200)}`), { status: 502 });
  const recipient = getAddress(`0x${s.destinationRecipient.slice(-40)}`);
  return { tx: res.tx, recipient, value: s.value.toString(), sourceDomain: s.sourceDomain };
}
