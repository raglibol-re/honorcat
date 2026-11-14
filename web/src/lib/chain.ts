import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

/** Public values only. Never put secrets in NEXT_PUBLIC_* variables. */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || arcTestnet.rpcUrls.default.http[0];
export const EXPLORER = arcTestnet.blockExplorers.default.url;
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

// Arc finalises in under a second; poll receipts every 500 ms instead of viem's 4 s default.
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL), pollingInterval: 500 });

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
