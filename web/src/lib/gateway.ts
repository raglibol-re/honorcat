"use client";

import { encodeFunctionData, erc20Abi, parseAbi, type Address, type Chain, type Hex } from "viem";
import { arbitrumSepolia, arcTestnet, avalancheFuji, baseSepolia, optimismSepolia, polygonAmoy, sepolia } from "viem/chains";
import { getJson } from "./api";
import type { WalletAdapter } from "./wallet/types";

/**
 * Circle Gateway in the browser: one USDC balance across chains. Deposit on any supported chain
 * (the wallet pays that chain's own fee), then move it to an account on Arc with one signature;
 * Circle attests and HonorCat's relay mints on Arc. Addresses: developers.circle.com/gateway.
 */
export const GATEWAY_WALLET: Address = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

export type GatewayChain = { domain: number; chain: Chain; name: string; usdc: Address; wait: string };
export const GATEWAY_CHAINS: GatewayChain[] = [
  { domain: 1, chain: avalancheFuji, name: "Avalanche Fuji", usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", wait: "about 8 seconds" },
  { domain: 6, chain: baseSepolia, name: "Base Sepolia", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", wait: "13 to 19 minutes" },
  { domain: 0, chain: sepolia, name: "Ethereum Sepolia", usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", wait: "13 to 19 minutes" },
  { domain: 3, chain: arbitrumSepolia, name: "Arbitrum Sepolia", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", wait: "13 to 19 minutes" },
  { domain: 2, chain: optimismSepolia, name: "OP Sepolia", usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", wait: "13 to 19 minutes" },
  { domain: 7, chain: polygonAmoy, name: "Polygon Amoy", usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", wait: "a few minutes" },
  { domain: 26, chain: arcTestnet, name: "Arc Testnet", usdc: "0x3600000000000000000000000000000000000000", wait: "about a second" },
];

const walletAbi = parseAbi(["function deposit(address token, uint256 value)"]);

const burnIntentTypes = {
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

export type GatewayBalance = { domain: number; name: string; balance: string; depositor: string };

export async function gatewayBalances(depositor: Address) {
  return (await getJson<{ balances: GatewayBalance[] }>(`/api/gateway/balances?depositor=${depositor}`)).balances;
}

/** Deposits USDC into Gateway on `c` from the wallet (two transactions on that chain: approve, deposit). */
export async function gatewayDeposit(adapter: WalletAdapter, c: GatewayChain, amount: bigint, onStep?: (s: string) => void) {
  if (!adapter.sendOn) throw new Error("This wallet cannot switch chains.");
  onStep?.(`Approve ${(Number(amount) / 1e6).toFixed(2)} USDC for Circle Gateway on ${c.name}`);
  await adapter.sendOn(c.chain, { to: c.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [GATEWAY_WALLET, amount] }) });
  onStep?.(`Deposit into Circle Gateway on ${c.name}`);
  return adapter.sendOn(c.chain, { to: GATEWAY_WALLET, data: encodeFunctionData({ abi: walletAbi, functionName: "deposit", args: [c.usdc, amount] }) });
}

type IntentJson = { maxBlockHeight: string; maxFee: string; spec: Record<string, string | number> };

/** Moves `value` from the depositor's Gateway balance on `sourceDomain` to `recipient` on Arc. */
export async function gatewayMove(adapter: WalletAdapter, input: { sourceDomain: number; depositor: Address; recipient: Address; value: bigint }, onStep?: (s: string) => void) {
  onStep?.("Asking Circle Gateway for the fee");
  const prep = await getJson<{ burnIntent: IntentJson; fee: string; domain: { name: string; version: string } }>("/api/gateway/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "prepare", sourceDomain: input.sourceDomain, depositor: input.depositor, recipient: input.recipient, value: input.value.toString() }),
  });
  const b = prep.burnIntent;
  const s = b.spec;
  const message = {
    maxBlockHeight: BigInt(b.maxBlockHeight),
    maxFee: BigInt(b.maxFee),
    spec: {
      version: Number(s.version),
      sourceDomain: Number(s.sourceDomain),
      destinationDomain: Number(s.destinationDomain),
      sourceContract: s.sourceContract as Hex,
      destinationContract: s.destinationContract as Hex,
      sourceToken: s.sourceToken as Hex,
      destinationToken: s.destinationToken as Hex,
      sourceDepositor: s.sourceDepositor as Hex,
      destinationRecipient: s.destinationRecipient as Hex,
      sourceSigner: s.sourceSigner as Hex,
      destinationCaller: s.destinationCaller as Hex,
      value: BigInt(s.value),
      salt: s.salt as Hex,
      hookData: (s.hookData ?? "0x") as Hex,
    },
  };
  onStep?.(`Sign the transfer in your wallet (Circle's fee at most $${(Number(prep.fee) / 1e6).toFixed(3)})`);
  const signature = await adapter.signTypedData({ domain: prep.domain, types: burnIntentTypes, primaryType: "BurnIntent", message });
  onStep?.("Circle attests the transfer; HonorCat mints it on Arc");
  return getJson<{ tx: Hex; recipient: Address; value: string }>("/api/gateway/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", burnIntent: b, signature }),
  });
}
