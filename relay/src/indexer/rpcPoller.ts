import { getAddress, type Address, type PublicClient } from "viem";
import { ARC_MEMO } from "../arc";
import { getState, setState, type Db } from "../db";
import { ingestLogs, type BlockTimeFn } from "./ingest";

const CURSOR_KEY = "rpc_last_indexed_block";
/** Arc caps eth_getLogs at 10,000 blocks per call; stay well below. */
const CHUNK = 5_000n;

export function blockTimeFromRpc(client: PublicClient): BlockTimeFn {
  const cache = new Map<bigint, number>();
  return async (n) => {
    if (cache.has(n)) return cache.get(n)!;
    try {
      const block = await client.getBlock({ blockNumber: n });
      const t = Number(block.timestamp);
      cache.set(n, t);
      return t;
    } catch {
      return null;
    }
  };
}

/** Fallback / primary indexer: pulls our contract's logs over RPC from the last cursor to the tip. */
export async function pollLogs(
  db: Db,
  client: PublicClient,
  vault: Address,
  deployBlock: bigint,
  opts: { maxBlocks?: bigint; deadlineMs?: number; book?: Address | null; merkle?: Address | null } = {},
): Promise<{ from: bigint; to: bigint; inserted: number } | null> {
  const stored = await getState(db, CURSOR_KEY);
  const cursor = stored !== undefined ? BigInt(stored) : deployBlock > 0n ? deployBlock - 1n : 0n;
  const tip = await client.getBlockNumber();
  if (tip <= cursor) return null;

  const maxBlocks = opts.maxBlocks ?? 500_000n;
  const end = tip - cursor > maxBlocks ? cursor + maxBlocks : tip;
  const blockTime = blockTimeFromRpc(client);
  let from = cursor + 1n;
  let inserted = 0;
  const started = Date.now();

  while (from <= end) {
    if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) break;
    const to = from + CHUNK - 1n > end ? end : from + CHUNK - 1n;
    // One call for the vault, the GuaranteeBook and Arc's Memo contract. Memo logs from other
    // users of the shared Memo contract are dropped unless their tx also touched our contracts.
    const addresses = [vault, ...(opts.book ? [opts.book] : []), ...(opts.merkle ? [opts.merkle] : []), ARC_MEMO];
    const all = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
    const ourTxs = new Set(all.filter((l) => getAddress(l.address) !== ARC_MEMO).map((l) => l.transactionHash));
    const logs = all.filter((l) => getAddress(l.address) !== ARC_MEMO || ourTxs.has(l.transactionHash));
    const res = await ingestLogs(
      db,
      vault,
      logs.map((l) => ({
        address: l.address,
        topics: l.topics,
        data: l.data,
        blockNumber: l.blockNumber!,
        transactionHash: l.transactionHash!,
        logIndex: l.logIndex!,
      })),
      "rpc",
      blockTime,
      { book: opts.book ?? null, merkle: opts.merkle ?? null },
    );
    inserted += res.inserted;
    await setState(db, CURSOR_KEY, to.toString());
    from = to + 1n;
  }
  return { from: cursor + 1n, to: from - 1n, inserted };
}
