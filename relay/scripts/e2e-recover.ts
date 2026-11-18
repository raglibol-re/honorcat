/**
 * Recovers test USDC left by e2e runs: for every key in data/e2e-keys.jsonl, takes back any open v2
 * offer it created (cancel) and sweeps the wallet's balance to the deployer. Keys never leave data/.
 * Run: cd relay && npx tsx --env-file=../.env scripts/e2e-recover.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC_USDC } from "../src/arc";
import { ropesAbi } from "../src/ropesAbi";

const rpc = process.env.ARC_RPC_URL!;
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const ROPES = JSON.parse(readFileSync(new URL("../../deployments/5042002.ropes.json", import.meta.url), "utf8")).ropes as Address;
const to = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex).address;
const keys = readFileSync(new URL("../../data/e2e-keys.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { address: Address; key: Hex });

async function main() {
  const next = (await client.readContract({ address: ROPES, abi: ropesAbi, functionName: "nextPotId" })) as bigint;
  for (const k of keys) {
    const a = privateKeyToAccount(k.key);
    const w = createWalletClient({ account: a, chain: arcTestnet, transport: http(rpc) });
    for (let id = 1n; id < next; id++) {
      const p = (await client.readContract({ address: ROPES, abi: ropesAbi, functionName: "pot", args: [id] })) as unknown as { state: number; creatorSide: number };
      if (Number(p.state) !== 1) continue; // Open
      const owner = (await client.readContract({ address: ROPES, abi: ropesAbi, functionName: "ownerOf", args: [id * 2n + BigInt(p.creatorSide)] })) as Address;
      if (owner.toLowerCase() !== a.address.toLowerCase()) continue;
      const h = await w.writeContract({ address: ROPES, abi: ropesAbi, functionName: "cancel", args: [id] });
      await client.waitForTransactionReceipt({ hash: h });
      console.log(`cancelled open pot ${id} of ${a.address}`);
    }
    const b = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [a.address] });
    if (b > 20_000n) {
      const h = await w.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [to, b - 20_000n] });
      await client.waitForTransactionReceipt({ hash: h });
      console.log(`swept ${Number(b - 20_000n) / 1e6} from ${a.address}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
