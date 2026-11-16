/**
 * Asks the app for a signed fair-value quote of a live pot and reads both sides' values from
 * HonorCatFairValue on Arc testnet (a view call: no transaction, no cost).
 * Usage: tsx scripts/pots-quote.ts <potId> [--api https://honorcat.vercel.app]
 */
import { parseArgs } from "node:util";
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { potsAbi } from "../src/potsAbi";

const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { api: { type: "string", default: "https://honorcat.vercel.app" } } });
const potId = positionals[0];
if (!potId) throw new Error("usage: pots-quote.ts <potId>");
const API = values.api!.replace(/\/$/, "");
const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io") });
const POTS = "0xc890C990048f45cb268d076E4A3dB25270Ea1e59" as Address;

type Quote = { id: string; status: string; reason: string | null; attestation: { potId: string; kind: number; nonce: string; windowStart: string; windowEnd: string; sampleCount: number; priceYes: number; valid: boolean; evidenceHash: Hex } | null; signatures: Hex | null; fairValue: Address | null };

const post = await fetch(`${API}/api/hc/pots/${potId}/quote`, { method: "POST" });
console.log("quote requested:", await post.text());
let q: Quote | null = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  q = (await (await fetch(`${API}/api/hc/pots/${potId}/quote`)).json()) as Quote;
  if (q.status === "ready" && q.signatures) break;
  if (i % 3 === 0) console.log(`  ${q.status}`);
}
if (!q?.signatures || !q.attestation || !q.fairValue) throw new Error(`no signed quote: ${JSON.stringify(q)}`);
console.log(`signed quote ${q.id}: ${(q.attestation.priceYes / 10_000).toFixed(2)}% YES (${q.reason})`);
const a = q.attestation;
const arg = { potId: BigInt(a.potId), kind: a.kind, nonce: BigInt(a.nonce), windowStart: BigInt(a.windowStart), windowEnd: BigInt(a.windowEnd), sampleCount: a.sampleCount, priceYes: a.priceYes, valid: a.valid, evidenceHash: a.evidenceHash };
const readerAbi = parseAbi([
  "struct WindowAttestation { uint256 potId; uint8 kind; uint64 nonce; uint64 windowStart; uint64 windowEnd; uint32 sampleCount; uint32 priceYes; bool valid; bytes32 evidenceHash; }",
  "function fairValue(address pots, uint8 side, WindowAttestation a, bytes sigs, uint256 maxAge) view returns (uint256 share, uint256 exitFee, uint32 priceYes)",
]);
for (const side of [0, 1] as const) {
  const [share, fee] = await client.readContract({ address: q.fairValue, abi: readerAbi, functionName: "fairValue", args: [POTS, side, arg, q.signatures, 600n] });
  console.log(`${side === 0 ? "YES" : "NO"} side of pot ${potId}: worth ${Number(share) / 1e6} USDC on-chain (exit fee ${Number(fee) / 1e6})`);
}
const p = (await client.readContract({ address: POTS, abi: potsAbi, functionName: "pot", args: [BigInt(potId)] })) as unknown as { notional: bigint };
console.log(`pot size ${Number(p.notional) / 1e6} USDC`);
