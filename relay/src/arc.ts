import { erc20Abi, parseGwei, type Address, type Hex, type PublicClient, type TypedDataDomain } from "viem";

/**
 * Arc-specific facts the relay relies on (checked against docs.arc.io and the live testnet RPC):
 *
 * - USDC is the native gas token. The same balance is exposed twice: natively with 18 decimals
 *   (eth_getBalance, gas accounting) and through the ERC-20 interface at 0x3600…0000 with 6
 *   decimals (transfers, the vault). 1 ERC-20 unit = 10^12 native wei.
 * - The base fee has a floor of 20 gwei; transactions priced below it are dropped silently,
 *   so every relay transaction is priced with an explicit floor.
 * - Finality is deterministic and sub-second (no reorgs), so the indexer reads `latest` with zero
 *   confirmations and the relay treats one receipt as final.
 * - The USDC contract is Circle's FiatToken v2: EIP-2612 permit and EIP-3009
 *   (transfer/receiveWithAuthorization). Its EIP-712 domain is name "USDC", version "2"; the
 *   relay reads both from the chain and checks them against DOMAIN_SEPARATOR().
 */
export const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
export const NATIVE_PER_USDC_UNIT = 10n ** 12n;
export const ARC_MIN_BASE_FEE = parseGwei("20");

/** 18-decimal native wei (gas) → 6-decimal USDC units, rounded up so costs are never understated. */
export function nativeToUsdcUnits(wei: bigint): bigint {
  return (wei + NATIVE_PER_USDC_UNIT - 1n) / NATIVE_PER_USDC_UNIT;
}

/**
 * EIP-1559 fees for Arc: viem's estimate, but never below the protocol floor plus headroom for
 * one base-fee increase (+12.5%), so a transaction is not silently dropped.
 */
export async function arcFees(client: PublicClient): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const est = await client.estimateFeesPerGas();
  const floor = (ARC_MIN_BASE_FEE * 1125n) / 1000n + est.maxPriorityFeePerGas;
  return {
    maxFeePerGas: est.maxFeePerGas > floor ? est.maxFeePerGas : floor,
    maxPriorityFeePerGas: est.maxPriorityFeePerGas,
  };
}

const domainAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

let domainCache: Promise<TypedDataDomain> | undefined;

/** The USDC EIP-712 domain, read from the token and verified against its DOMAIN_SEPARATOR. */
export function usdcDomain(client: PublicClient, chainId: number, usdc: Address = ARC_USDC): Promise<TypedDataDomain> {
  domainCache ??= (async () => {
    const [name, version, separator] = await Promise.all([
      client.readContract({ address: usdc, abi: domainAbi, functionName: "name" }),
      client.readContract({ address: usdc, abi: domainAbi, functionName: "version" }),
      client.readContract({ address: usdc, abi: domainAbi, functionName: "DOMAIN_SEPARATOR" }),
    ]);
    const domain = { name, version, chainId, verifyingContract: usdc } as const;
    const { hashDomain } = await import("viem");
    const computed = hashDomain({
      domain: { ...domain, chainId: BigInt(chainId) },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    });
    if (computed !== (separator as Hex)) throw new Error("USDC DOMAIN_SEPARATOR does not match name/version/chainId");
    return domain;
  })().catch((err) => {
    domainCache = undefined;
    throw err;
  });
  return domainCache;
}

/** For tests. */
export function setUsdcDomainForTests(domain: TypedDataDomain | undefined) {
  domainCache = domain ? Promise.resolve(domain) : undefined;
}

/**
 * Reads an account's USDC through both interfaces. On Arc they must agree (native = erc20 × 1e12);
 * /api/status shows the check as evidence of the dual-decimal model.
 */
export async function usdcBalances(client: PublicClient, account: Address, usdc: Address = ARC_USDC) {
  const [native, erc20] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
  ]);
  return { native, erc20, consistent: native / NATIVE_PER_USDC_UNIT === erc20 };
}
