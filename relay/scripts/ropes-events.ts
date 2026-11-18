// Prints HonorCat v2 events from Arc (divisions, treats, lives, copies, joins). Run: npx tsx --env-file=../.env scripts/ropes-events.ts
import { createPublicClient, http, parseEventLogs } from "viem";
import { arcTestnet } from "viem/chains";
import { ropesAbi } from "../src/ropesAbi";
const c = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL) });
const head = await c.getBlockNumber();
const logs = await c.getLogs({ address: "0x6A30Bc4F1867A4441Ac2e7e1e77Cb40E79F9Cf44", fromBlock: 72860936n, toBlock: head });
for (const l of parseEventLogs({ abi: ropesAbi, logs })) {
  if (!["PotDivided", "CopycatTreat", "MakerTreat", "ExtraLife", "CopyMarked", "Joined", "ExpiryWindowFailed"].includes(l.eventName)) continue;
  console.log(l.eventName, JSON.stringify(l.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), l.transactionHash.slice(0, 12));
}
