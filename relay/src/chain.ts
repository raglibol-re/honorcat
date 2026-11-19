import { circleRelay } from "./circleWallet";
import type { Address } from "viem";
import { createPublicClient, createWalletClient, fallback, http, type PublicClient, type Transport } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { getConfig } from "./config";

export { arcTestnet };

export const ARC_RECEIPT_POLL_MS = 500;

let pub: PublicClient | undefined;

/**
 * The relay's RPC: ARC_RPC_URL first, then any ARC_RPC_FALLBACK_URLS (comma-separated) when it fails
 * or rate-limits. Requests made together are batched into one HTTP call; each attempt times out
 * after 8 s instead of hanging.
 */
function rpcTransport(): Transport {
  const urls = [getConfig().rpcUrl, ...(process.env.ARC_RPC_FALLBACK_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean)];
  // The public RPC answers bursts with -32005 (viem: "Request exceeds defined limit."): back off
  // 250, 500, 1000, 2000 ms before giving up.
  const one = (u: string) => http(u, { retryCount: 4, retryDelay: 250, timeout: 8_000, batch: { wait: 10 } });
  return urls.length > 1 ? fallback(urls.map(one), { rank: false }) : one(urls[0]!);
}

export function publicClient(): PublicClient {
  // Arc has deterministic sub-second finality (~2 blocks/s). viem's default 4 s polling would
  // dominate settlement latency, so receipts are polled every 500 ms; one receipt is final.
  pub ??= createPublicClient({
    chain: arcTestnet,
    transport: rpcTransport(),
    pollingInterval: ARC_RECEIPT_POLL_MS,
  });
  return pub;
}

export function resolverAccount(): PrivateKeyAccount {
  const key = getConfig().resolverKey;
  if (!key) throw new Error("RELAY_PRIVATE_KEY is not set");
  return privateKeyToAccount(key);
}

export function resolverWallet() {
  return createWalletClient({
    account: resolverAccount(),
    chain: arcTestnet,
    transport: http(getConfig().rpcUrl, { retryCount: 3 }),
    pollingInterval: ARC_RECEIPT_POLL_MS,
  });
}

/**
 * The address that sends HonorCat's pot transactions and holds the test-money pool: the Circle
 * developer-controlled wallet when configured, else the relay key's own address.
 */
export function relaySender(): Address {
  const c = circleRelay();
  return c ? c.address : resolverAccount().address;
}
