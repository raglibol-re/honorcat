import { BaseError, ContractFunctionRevertedError, type Hex, type TransactionReceipt } from "viem";
import { verdictVaultAbi } from "./abi";
import { arcFees } from "./arc";
import { publicClient, resolverAccount, resolverWallet } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { ingestLogs } from "./indexer/ingest";
import { blockTimeFromRpc } from "./indexer/rpcPoller";

export type TxKind = "resolve" | "expire" | "fund_gasless" | "create_gasless";

type VaultFunction = "resolve" | "expire" | "fundWithAuthorization" | "createPotWithAuthorization";

export type TxResult =
  | { ok: true; tx: Hex; receipt: TransactionReceipt; potIds: string[] }
  | { ok: false; tx?: Hex; error: string; revert?: string };

/** Name of the custom error (or reason string) a viem error wraps, if it is a revert. */
export function revertName(err: unknown): string | undefined {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "reverted";
  }
  return undefined;
}

/**
 * The one path by which the relay sends a transaction to the vault:
 * simulate (a revert costs nothing) → price with Arc's fee floor → send → wait for the receipt
 * (one receipt is final on Arc) → ingest the receipt logs immediately → record gas paid in USDC.
 */
export async function sendVaultTx(
  db: Db,
  kind: TxKind,
  functionName: VaultFunction,
  args: readonly unknown[],
  potId?: string,
): Promise<TxResult> {
  const { vault } = getConfig();
  const client = publicClient();
  const account = resolverAccount();
  let tx: Hex | undefined;
  try {
    const { request } = await client.simulateContract({
      account,
      address: vault,
      abi: verdictVaultAbi,
      functionName,
      args: args as never,
    });
    const fees = await arcFees(client);
    const started = Date.now();
    tx = await resolverWallet().writeContract({ ...request, ...fees } as never);
    await db.query(
      `INSERT INTO relay_txs (tx_hash, kind, pot_id, status) VALUES ($1, $2, $3, 'submitted')
       ON CONFLICT (tx_hash) DO NOTHING`,
      [tx, kind, potId ?? null],
    );
    const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 45_000 });
    const fee = receipt.gasUsed * receipt.effectiveGasPrice;
    const ingested = await ingestLogs(
      db,
      vault,
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
    );
    const resolvedPot = potId ?? ingested.pots[0] ?? null;
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
        Date.now() - started,
        resolvedPot,
      ],
    );
    if (receipt.status !== "success") return { ok: false, tx, error: "tx reverted" };
    return { ok: true, tx, receipt, potIds: ingested.pots };
  } catch (err) {
    const revert = revertName(err);
    return { ok: false, tx, revert, error: revert ?? (err instanceof Error ? err.message.split("\n")[0]! : String(err)) };
  }
}
