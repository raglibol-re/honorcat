/**
 * Send money to a player by name, end to end on the live site: two passkey accounts (a software
 * authenticator stands in for the device), the receiver names its cat, the sender finds it by that
 * name and sends test USDC with one passkey confirmation; HonorCat pays the fee.
 *
 *   npx tsx --env-file=../.env scripts/send-e2e.ts [--api https://honorcat.vercel.app] [--value 0.03]
 */
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC_USDC } from "../src/arc";
import { softPasskey } from "../src/softPasskey";

const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { api: { type: "string", default: "https://honorcat.vercel.app" }, value: { type: "string", default: "0.03" } } });
const API = values.api!.replace(/\/$/, "");
const rpc = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const pub = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function api<T>(path: string, json?: unknown): Promise<T> {
  const r = await fetch(API + path, json ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) } : undefined);
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t) as T;
}

const rpId = new URL(API).hostname;
const sender = await softPasskey(rpId);
const receiver = await softPasskey(rpId);
const a = (await api<{ account: Address }>("/api/passkeys/register", { credentialId: sender.credentialId, qx: sender.qx, qy: sender.qy })).account;
const b = (await api<{ account: Address }>("/api/passkeys/register", { credentialId: receiver.credentialId, qx: receiver.qx, qy: receiver.qy })).account;
log(`sender ${a}, receiver ${b}`);

// The receiver names its cat (signed with its passkey).
const name = `Sendtest${Math.floor(Math.random() * 1e6)}`;
const issuedAt = new Date().toISOString();
const message = `HonorCat: call me "${name}" on HonorCat.\nAccount: ${getAddress(b)}\nIssued: ${issuedAt}`;
await api("/api/hc/names", { account: b, name, issuedAt, passkey: await receiver.sign(keccak256(stringToBytes(message))) });
log(`receiver is called ${name}`);

// Test money for the sender (from the deployer).
const value = BigInt(Math.round(Number(values.value) * 1e6));
const deployer = createWalletClient({ account: privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex), chain: arcTestnet, transport: http(rpc) });
await pub.waitForTransactionReceipt({ hash: await deployer.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [a, value] }) });

// Find the receiver by name, as the send form does.
const found = (await api<{ players: { account: Address; name: string | null }[] }>(`/api/hc/players?q=${encodeURIComponent(name)}`)).players;
const to = found.find((p) => p.name === name)?.account;
if (!to || getAddress(to) !== getAddress(b)) throw new Error(`"${name}" was not found by name`);
log(`found ${name} by name`);

const before = await pub.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [b] });
const t0 = Date.now();
const prep = await api<{ challenge: Hex; deadline: string }>("/api/hc/send/prepare", { account: a, to, value: value.toString() });
const sent = await api<{ tx: Hex; toName: string | null }>("/api/hc/send", { account: a, to, value: value.toString(), deadline: prep.deadline, assertion: await sender.sign(prep.challenge) });
await pub.waitForTransactionReceipt({ hash: sent.tx });
const bal = await pub.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [b] });
// (a new account may also get HonorCat's welcome test money; only the change counts)
if (bal - before !== value) throw new Error(`receiver got ${bal - before}, expected ${value}`);
log(`sent $${values.value} to ${sent.toName} in ${Date.now() - t0} ms; HonorCat paid the fee (tx ${sent.tx})`);
process.exit(0);
