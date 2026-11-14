/**
 * Probes Arc's transaction extensions on testnet before Verdict relies on them:
 *   1. Memo and Multicall3From have code at the documented addresses
 *   2. the documented Memo topic0 matches the event signature
 *   3. a direct Memo.memo(USDC.transfer) keeps the EOA as sender and emits BeforeMemo/Memo
 *   4. Multicall3From.aggregate3 can nest a Memo.memo call (needed for batched, memo'd settlement)
 * Sends two tiny USDC transfers (1 base unit each) from the deployer to the resolver.
 *
 *   pnpm --filter @verdict/relay exec tsx --env-file=../.env scripts/probe-arc-extensions.ts
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  toEventSelector,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const MEMO = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const MULTICALL3_FROM = "0x522fAf9A91c41c443c66765030741e4AaCe147D0";
const USDC = "0x3600000000000000000000000000000000000000";
const DOC_MEMO_TOPIC0 = "0xeb15ee720798341c37739df41be53acfbbf70ae6802dade35457beec6e47a5e4";

const memoAbi = parseAbi([
  "function memo(address target, bytes data, bytes32 memoId, bytes memoData)",
  "event BeforeMemo(uint256 indexed memoIndex)",
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
]);
const mcAbi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) returns (Result[])",
]);

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
const to = privateKeyToAccount(process.env.RESOLVER_PRIVATE_KEY as Hex).address;
const pub = createPublicClient({ chain: arcTestnet, transport: http(), pollingInterval: 500 });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });

const memoSig = "Memo(address,address,bytes32,bytes32,bytes,uint256)";
console.log("Memo code bytes:", ((await pub.getCode({ address: MEMO })) ?? "0x").length / 2 - 1);
console.log("Multicall3From code bytes:", ((await pub.getCode({ address: MULTICALL3_FROM })) ?? "0x").length / 2 - 1);
console.log("Memo topic0 computed:", toEventSelector(memoSig), "matches docs:", toEventSelector(memoSig) === DOC_MEMO_TOPIC0);
console.log("BeforeMemo topic0:", toEventSelector("BeforeMemo(uint256)"));

function show(label: string, logs: { address: string; topics: readonly Hex[]; data: Hex }[]) {
  console.log(`-- ${label}: ${logs.length} logs`);
  for (const l of logs) {
    const name =
      l.topics[0] === DOC_MEMO_TOPIC0 ? "Memo" : l.topics[0] === toEventSelector("BeforeMemo(uint256)") ? "BeforeMemo" : l.topics[0]?.slice(0, 10);
    console.log(`   ${l.address} ${name} topics=${l.topics.length}`);
  }
}

const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 1n] });

// 3. direct memo
const id1 = keccak256(stringToHex(`probe-direct-${Date.now()}`));
const tx1 = await wallet.writeContract({ address: MEMO, abi: memoAbi, functionName: "memo", args: [USDC, transfer, id1, stringToHex("verdict probe: direct")] });
const r1 = await pub.waitForTransactionReceipt({ hash: tx1 });
show(`direct memo ${tx1} status=${r1.status} gas=${r1.gasUsed}`, r1.logs);
const memoLog1 = r1.logs.find((l) => l.topics[0] === DOC_MEMO_TOPIC0);
console.log("   Memo.sender topic == EOA:", memoLog1?.topics[1]?.toLowerCase().endsWith(account.address.slice(2).toLowerCase()));

// 4. Multicall3From -> [USDC.transfer, Memo.memo(USDC.transfer)]
const id2 = keccak256(stringToHex(`probe-nested-${Date.now()}`));
const nested = encodeFunctionData({ abi: memoAbi, functionName: "memo", args: [USDC, transfer, id2, stringToHex("verdict probe: nested in multicall")] });
try {
  const sim = await pub.simulateContract({
    account,
    address: MULTICALL3_FROM,
    abi: mcAbi,
    functionName: "aggregate3",
    args: [[{ target: USDC, allowFailure: false, callData: transfer }, { target: MEMO, allowFailure: false, callData: nested }]],
  });
  const tx2 = await wallet.writeContract(sim.request);
  const r2 = await pub.waitForTransactionReceipt({ hash: tx2 });
  show(`multicall(transfer, memo(transfer)) ${tx2} status=${r2.status} gas=${r2.gasUsed}`, r2.logs);
  const memoLog2 = r2.logs.find((l) => l.topics[0] === DOC_MEMO_TOPIC0);
  console.log("   nested Memo.sender == EOA:", memoLog2?.topics[1]?.toLowerCase().endsWith(account.address.slice(2).toLowerCase()));
} catch (err) {
  console.log("multicall nesting failed:", (err as Error).message.split("\n").slice(0, 3).join(" | "));
}
console.log("salt hex sample", toHex(1));
