import { createPublicClient, createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { getConfig } from "./config";

export { arcTestnet };

export const ARC_RECEIPT_POLL_MS = 500;

let pub: PublicClient | undefined;

export function publicClient(): PublicClient {
  // Arc has deterministic sub-second finality (~2 blocks/s). viem's default 4 s polling would
  // dominate settlement latency, so receipts are polled every 500 ms; one receipt is final.
  pub ??= createPublicClient({
    chain: arcTestnet,
    transport: http(getConfig().rpcUrl, { retryCount: 3 }),
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
