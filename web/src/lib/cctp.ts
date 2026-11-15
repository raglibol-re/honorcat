/**
 * Circle CCTP V2 on testnets: move USDC from another chain to Arc by burn and mint.
 * Addresses and domains from developers.circle.com/cctp/references/contract-addresses
 * (identical on every EVM testnet, Arc Testnet included, domain 26).
 */
import { encodeFunctionData, pad, parseAbi, type Address, type Chain, type Hex } from "viem";
import { arbitrumSepolia, avalancheFuji, baseSepolia, optimismSepolia, polygonAmoy, sepolia } from "viem/chains";

export const TOKEN_MESSENGER_V2: Address = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
export const MESSAGE_TRANSMITTER_V2: Address = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
export const ARC_DOMAIN = 26;
export const IRIS = "https://iris-api-sandbox.circle.com";
/** 1000: Fast Transfer (confirmed, seconds); 2000: Standard (finalized, ~15-20 min on Ethereum L1/L2s). */
export const FAST = 1000;

export type SourceChain = { chain: Chain; domain: number; usdc: Address; short: string };

export const SOURCES: SourceChain[] = [
  { chain: baseSepolia, domain: 6, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", short: "Base Sepolia" },
  { chain: sepolia, domain: 0, usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", short: "Ethereum Sepolia" },
  { chain: arbitrumSepolia, domain: 3, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", short: "Arbitrum Sepolia" },
  { chain: optimismSepolia, domain: 2, usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", short: "OP Sepolia" },
  { chain: avalancheFuji, domain: 1, usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", short: "Avalanche Fuji" },
  { chain: polygonAmoy, domain: 7, usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", short: "Polygon Amoy" },
];

/** Solana Devnet (burn built in lib/solana.ts). */
export const SOLANA_DOMAIN = 5;
/** Every source domain the relay will finish a transfer from. */
export const SOURCE_DOMAINS = [...SOURCES.map((s) => s.domain), SOLANA_DOMAIN];

export const sourceById = (chainId: number | null | undefined) => SOURCES.find((s) => s.chain.id === chainId) ?? null;

export const tokenMessengerAbi = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);
export const messageTransmitterAbi = parseAbi(["function receiveMessage(bytes message, bytes attestation) returns (bool)"]);

/** Fast Transfer fee in basis points (may be fractional, e.g. 1.3) from Iris. */
export async function fastFeeBps(domain: number): Promise<number> {
  const r = await fetch(`${IRIS}/v2/burn/USDC/fees/${domain}/${ARC_DOMAIN}`);
  if (!r.ok) throw new Error(`fee lookup failed (${r.status})`);
  const rows = (await r.json()) as { finalityThreshold: number; minimumFee: number }[];
  return rows.find((x) => x.finalityThreshold === FAST)?.minimumFee ?? 0;
}

/**
 * How much to burn so that at least `need` (USDC base units) is minted on Arc. The fee is taken
 * from the burned amount; maxFee caps it. A 20% margin on the quoted rate plus 1 unit absorbs
 * rounding and small fee moves; any unused fee is minted to the recipient too.
 */
export function burnFor(need: bigint, feeBps: number): { amount: bigint; maxFee: bigint } {
  const rate = BigInt(Math.ceil(feeBps * 1.2 * 100)); // in 1/1_000_000
  const maxFee = (need * rate + 999_999n) / 1_000_000n + 1n;
  return { amount: need + maxFee, maxFee };
}

export function depositForBurnData(amount: bigint, recipient: Address, usdc: Address, maxFee: bigint): Hex {
  return encodeFunctionData({
    abi: tokenMessengerAbi,
    functionName: "depositForBurn",
    args: [amount, ARC_DOMAIN, pad(recipient, { size: 32 }), usdc, pad("0x00", { size: 32 }), maxFee, FAST],
  });
}

export type IrisMessage = { status: string; message: Hex; attestation: Hex };

/** The attested message for a burn transaction, or null while Circle has not signed it yet. */
export async function irisMessage(domain: number, txHash: string): Promise<IrisMessage | null> {
  const r = await fetch(`${IRIS}/v2/messages/${domain}?transactionHash=${txHash}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`attestation lookup failed (${r.status})`);
  const body = (await r.json()) as { messages?: { status?: string; message?: string; attestation?: string }[] };
  const m = body.messages?.[0];
  if (!m || m.status !== "complete" || !m.attestation || m.attestation === "PENDING" || !m.message?.startsWith("0x")) return null;
  return { status: m.status, message: m.message as Hex, attestation: m.attestation as Hex };
}

/**
 * Fields of a CCTP V2 message header: version (4 bytes), sourceDomain (4), destinationDomain (4),
 * nonce (32), sender (32), recipient (32), destinationCaller (32), minFinalityThreshold (4),
 * finalityThresholdExecuted (4), then the message body.
 */
export function parseHeader(message: Hex) {
  const b = message.slice(2);
  const word = (start: number, len: number) => `0x${b.slice(start * 2, (start + len) * 2)}` as Hex;
  if (b.length < 148 * 2) throw new Error("message too short");
  return {
    version: Number.parseInt(b.slice(0, 8), 16),
    sourceDomain: Number.parseInt(b.slice(8, 16), 16),
    destinationDomain: Number.parseInt(b.slice(16, 24), 16),
    // bytes 76..108; the address is the low 20 bytes
    recipient: `0x${b.slice(88 * 2, 108 * 2)}` as Address,
    destinationCaller: word(108, 32),
  };
}
