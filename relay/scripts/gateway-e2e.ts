/**
 * Circle Gateway through HonorCat's endpoints: a depositor with a Gateway balance moves USDC to a
 * fresh account on Arc ("prepare" with Circle's fee, sign the BurnIntent, "complete": Circle attests,
 * the relay's Circle wallet mints). Optional --deposit 1 deposits first on Arc.
 * Usage: tsx --env-file=../.env scripts/gateway-e2e.ts [--deposit 1] [--value 0.4]
 */
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { burnIntentTypes, GATEWAY_WALLET, gatewayWalletAbi } from "../src/gateway";
const { values } = parseArgs({ args: process.argv.slice(2), options: { deposit: { type: "string" }, value: { type: "string", default: "0.4" }, api: { type: "string", default: "https://honorcat.vercel.app" } } });
const API = values.api!;
const USDC = "0x3600000000000000000000000000000000000000";
const c = createPublicClient({ chain: arcTestnet, transport: http("https://rpc.testnet.arc.io") });
const me = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
const w = createWalletClient({ account: me, chain: arcTestnet, transport: http("https://rpc.testnet.arc.io") });
const post = async (body: unknown) => { const r = await fetch(`${API}/api/gateway/move`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(t); return JSON.parse(t); };
if (values.deposit) {
  const v = BigInt(Math.round(Number(values.deposit) * 1e6));
  for (const data of [encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [GATEWAY_WALLET, v] }), encodeFunctionData({ abi: gatewayWalletAbi, functionName: "deposit", args: [USDC, v] })])
    await c.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: data.startsWith("0x095ea7b3") ? USDC : GATEWAY_WALLET, data }) });
  console.log(`deposited ${values.deposit} USDC into Gateway on Arc`);
  await new Promise((r) => setTimeout(r, 4000));
}
console.log("balances", JSON.stringify((await (await fetch(`${API}/api/gateway/balances?depositor=${me.address}`)).json()).balances.filter((b: { balance: string }) => Number(b.balance) > 0)));
const recipient = privateKeyToAccount(generatePrivateKey()).address;
const prep = await post({ action: "prepare", sourceDomain: 26, depositor: me.address, recipient, value: String(Math.round(Number(values.value) * 1e6)) });
console.log(`prepared: Circle's fee at most $${Number(prep.fee) / 1e6}`);
const b = prep.burnIntent; const s = b.spec;
const message = { maxBlockHeight: BigInt(b.maxBlockHeight), maxFee: BigInt(b.maxFee), spec: { ...s, version: Number(s.version), sourceDomain: Number(s.sourceDomain), destinationDomain: Number(s.destinationDomain), value: BigInt(s.value) } };
const signature = await me.signTypedData({ domain: prep.domain, types: burnIntentTypes, primaryType: "BurnIntent", message });
const t0 = Date.now();
const done = await post({ action: "complete", burnIntent: b, signature });
const r = await c.getTransactionReceipt({ hash: done.tx });
console.log(`minted on Arc by ${r.from} in ${Date.now() - t0} ms (tx ${done.tx}); recipient holds ${Number(await c.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [recipient] })) / 1e6} USDC`);
process.exit(0);
