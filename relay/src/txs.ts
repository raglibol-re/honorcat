import { circleRelay, sendViaCircle } from "./circleWallet";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { batchGuardAbi, guaranteeBookAbi, merkleBookAbi, vaultAbi } from "./abi";
import { arcFees, ARC_MULTICALL3_FROM } from "./arc";
import { publicClient, resolverAccount, resolverWallet } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { ingestLogs } from "./indexer/ingest";
import { blockTimeFromRpc } from "./indexer/rpcPoller";
import { memoAbi } from "./memo";

export type TxKind =
  | "resolve"
  | "expire"
  | "fund_gasless"
  | "create_gasless"
  | "settle_batch"
  | "guarantee_create"
  | "guarantee_enrol"
  | "guarantee_refunds"
  | "withdraw"
  | "drop_create"
  | "drop_root"
  | "drop_claims"
  | "drop_sweep"
  | "early_create"
  | "early_join"
  | "early_settle"
  | "early_record"
  | "cctp_receive"
  | "pot_create"
  | "pot_join"
  | "pot_exit"
  | "pot_attest"
  | "pot_settle"
  | "pot_house"
  | "pot_exec"
  | "pot_forward"
  | "pot_gateway";

type VaultFunction = "resolve" | "expire" | "fundWithAuthorization" | "createPotWithAuthorization";

export type RelayCall = { target: Address; callData: Hex; potIds?: string[]; label?: string };

export type TxResult =
  | { ok: true; tx: Hex; receipt: TransactionReceipt; potIds: string[]; dropped: { call: RelayCall; error: string }[] }
  | { ok: false; tx?: Hex; error: string; revert?: string; dropped: { call: RelayCall; error: string }[] };

export const multicall3FromAbi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) returns (Result[] returnData)",
]);

const errorAbis = [vaultAbi, guaranteeBookAbi, merkleBookAbi, batchGuardAbi, memoAbi, parseAbi(["error Error(string)"])] as const;

/** Name of a revert from raw return data; unwraps Arc's Memo `MemoFailed(bytes)` wrapper. */
export function decodeRevert(data: Hex | undefined, depth = 0): string {
  if (!data || data === "0x") return "reverted";
  for (const abi of errorAbis) {
    try {
      const e = decodeErrorResult({ abi: abi as never, data });
      if (e.errorName === "MemoFailed" && depth < 3) return decodeRevert((e.args as unknown as [Hex])[0], depth + 1);
      if (e.errorName === "Error") return String((e.args as unknown as [string])[0]);
      return e.errorName;
    } catch {
      /* try next */
    }
  }
  return `reverted (${data.slice(0, 10)})`;
}

/** Name of the custom error (or reason string) a viem error wraps, if it is a revert. */
export function revertName(err: unknown): string | undefined {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "reverted";
  }
  return undefined;
}

/**
 * The one path by which the relay sends transactions.
 *
 * One call goes straight to its target; several go through Arc's Multicall3From.aggregate3, where
 * each subcall still sees the relay EOA as msg.sender (CallFrom). The batch is simulated first:
 * failing subcalls are dropped and reported (a revert costs nothing), unless `atomic` is set, in
 * which case any failure aborts. Then: Arc fee floor, send, one receipt (final on Arc), ingest the
 * receipt's logs immediately, record gas paid in USDC per transaction and the pots it touched.
 */
export { circleRelay };

export async function sendRelayCalls(
  db: Db,
  kind: TxKind,
  calls: RelayCall[],
  opts: { atomic?: boolean; memoTxsOf?: boolean } = {},
): Promise<TxResult> {
  const client = publicClient();
  // Pot transactions go out from the Circle-held relay wallet when it is configured; the retired
  // products keep their own key.
  const circle = kind.startsWith("pot_") ? circleRelay() : null;
  const account = circle ? circle.address : resolverAccount();
  const dropped: { call: RelayCall; error: string }[] = [];
  if (calls.length === 0) return { ok: false, error: "no calls", dropped };

  // Simulate everything as one aggregate3 to learn which subcalls would fail.
  let live = calls;
  try {
    const sim = await client.simulateContract({
      account,
      address: ARC_MULTICALL3_FROM,
      abi: multicall3FromAbi,
      functionName: "aggregate3",
      args: [calls.map((c) => ({ target: c.target, allowFailure: !opts.atomic, callData: c.callData }))],
    });
    const results = sim.result as readonly { success: boolean; returnData: Hex }[];
    live = calls.filter((c, i) => {
      if (results[i]?.success) return true;
      dropped.push({ call: c, error: decodeRevert(results[i]?.returnData) });
      return false;
    });
  } catch (err) {
    // atomic batch reverted as a whole (or RPC error): find the first failing call for the message
    const msg = revertName(err) ?? (err instanceof Error ? err.message.split("\n")[0]! : String(err));
    let detail = msg;
    if (opts.atomic) {
      for (const c of calls) {
        try {
          await client.call({ account, to: c.target, data: c.callData });
        } catch (e) {
          const data = (e as { data?: Hex; cause?: { data?: Hex } }).data ?? (e as { cause?: { data?: Hex } }).cause?.data;
          detail = `${c.label ?? c.target}: ${data ? decodeRevert(data) : msg}`;
          break;
        }
      }
    }
    return { ok: false, error: detail, revert: detail, dropped };
  }
  if (live.length === 0) return { ok: false, error: dropped.map((d) => d.error).join("; "), dropped };

  const potIds = [...new Set(live.flatMap((c) => c.potIds ?? []))];
  let tx: Hex | undefined;
  try {
    const fees = await arcFees(client);
    const single = live.length === 1 && !opts.atomic;
    const data = single
      ? live[0]!.callData
      : encodeFunctionData({
          abi: multicall3FromAbi,
          functionName: "aggregate3",
          args: [live.map((c) => ({ target: c.target, allowFailure: !opts.atomic, callData: c.callData }))],
        });
    const to = single ? live[0]!.target : ARC_MULTICALL3_FROM;
    const started = Date.now();
    tx = circle ? await sendViaCircle(to, data, `${kind}`) : await resolverWallet().sendTransaction({ to, data, ...fees } as never);
    await db.query(
      `INSERT INTO relay_txs (tx_hash, kind, pot_id, status) VALUES ($1, $2, $3, 'submitted') ON CONFLICT (tx_hash) DO NOTHING`,
      [tx, kind, potIds.length === 1 ? potIds[0] : null],
    );
    for (const p of potIds) {
      await db.query("INSERT INTO relay_tx_pots (tx_hash, pot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [tx, p]);
    }
    const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 45_000 });
    const latency = Date.now() - started;
    const fee = receipt.gasUsed * receipt.effectiveGasPrice;
    const cfg = getConfig();
    const ingested = await ingestLogs(
      db,
      cfg.vault,
      receipt.logs.map((l) => ({
        address: l.address,
        topics: l.topics,
        data: l.data,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex,
      })),
      "receipt",
      blockTimeFromRpc(client),
      { memoTxs: opts.memoTxsOf ? [tx] : [], extraMemoTargets: opts.memoTxsOf ? live.map((c) => c.target) : [] },
    );
    const allPots = [...new Set([...potIds, ...ingested.pots])];
    for (const p of allPots) {
      await db.query("INSERT INTO relay_tx_pots (tx_hash, pot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [tx, p]);
    }
    await db.query(
      `UPDATE relay_txs SET status = $2, gas_used = $3, effective_gas_price = $4, fee_wei = $5,
         block_number = $6, confirmed_at = now(), latency_ms = $7, pot_id = COALESCE(pot_id, $8)
       WHERE tx_hash = $1`,
      [
        tx,
        receipt.status === "success" ? "confirmed" : "reverted",
        receipt.gasUsed.toString(),
        receipt.effectiveGasPrice.toString(),
        fee.toString(),
        receipt.blockNumber.toString(),
        latency,
        allPots.length === 1 ? allPots[0] : null,
      ],
    );
    if (receipt.status !== "success") return { ok: false, tx, error: "tx reverted", dropped };
    return { ok: true, tx, receipt, potIds: allPots, dropped };
  } catch (err) {
    const revert = revertName(err);
    return { ok: false, tx, revert, error: revert ?? (err instanceof Error ? err.message.split("\n")[0]! : String(err)), dropped };
  }
}

/** Single vault call (kept for the gasless endpoints). */
export async function sendVaultTx(
  db: Db,
  kind: TxKind,
  functionName: VaultFunction,
  args: readonly unknown[],
  potId?: string,
): Promise<TxResult> {
  const { vault } = getConfig();
  const callData = encodeFunctionData({ abi: vaultAbi, functionName, args: args as never });
  const res = await sendRelayCalls(db, kind, [{ target: vault, callData, potIds: potId ? [potId] : [], label: functionName }]);
  if (!res.ok && res.dropped.length && !res.revert) return { ...res, revert: res.dropped[0]!.error, error: res.dropped[0]!.error };
  return res;
}
