import { createPublicClient, createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { getConfig } from "./config";

export { arcTestnet };

let pub: PublicClient | undefined;

export function publicClient(): PublicClient {
  pub ??= createPublicClient({ chain: arcTestnet, transport: http(getConfig().rpcUrl, { retryCount: 3 }) });
  return pub;
}

export function resolverAccount(): PrivateKeyAccount {
  const key = getConfig().resolverKey;
  if (!key) throw new Error("RESOLVER_PRIVATE_KEY is not set");
  return privateKeyToAccount(key);
}

export function resolverWallet() {
  return createWalletClient({
    account: resolverAccount(),
    chain: arcTestnet,
    transport: http(getConfig().rpcUrl, { retryCount: 3 }),
  });
}
