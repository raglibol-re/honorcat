import {
  decodeEventLog,
  encodeFunctionData,
  hexToString,
  keccak256,
  parseAbi,
  stringToBytes,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { ARC_MEMO } from "./arc";

/**
 * Arc transaction memos (docs.arc.io/arc/concepts/transaction-memos).
 *
 *   Memo.memo(target, data, memoId, memoData) calls `target` with `data` through CallFrom, so the
 *   target sees the submitting EOA as msg.sender, and logs BeforeMemo(memoIndex) … target logs …
 *   Memo(sender, target, callDataHash, memoId, memo, memoIndex).
 *
 * HonorCat's convention:
 *   memoId   = the external reference (order / promotion / guarantee id) as bytes32: readable
 *              ASCII when it fits in 32 bytes, otherwise keccak256 of it.
 *   memoData = UTF-8 JSON, versioned: {"v":1,"t":"fund|payout|refund|expire|refunds|withdraw",
 *              "ref":…, "why": plain reason, …}. Kept short (it is calldata).
 */
export const memoAbi = parseAbi([
  "function memo(address target, bytes data, bytes32 memoId, bytes memoData)",
  "event BeforeMemo(uint256 indexed memoIndex)",
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
  "error MemoFailed(bytes)",
]);

export type MemoBody = {
  v: 1;
  t: "fund" | "payout" | "refund" | "expire" | "refunds" | "withdraw" | "early" | "record" | "pot";
  ref?: string;
  why?: string;
  pot?: string;
  src?: string;
  mkt?: string;
  res?: "YES" | "NO";
  [k: string]: unknown;
};

export function memoIdFor(ref: string): Hex {
  const bytes = stringToBytes(ref);
  const ascii = /^[\x20-\x7e]*$/.test(ref);
  return ascii && bytes.length <= 32 ? (toHex(bytes, { size: 32 }) as Hex) : keccak256(bytes);
}

/** Reverses memoIdFor for readable ids; returns null for hashed ones. */
export function memoIdText(id: Hex): string | null {
  try {
    const s = hexToString(id, { size: 32 }).replace(/\0+$/, "");
    return /^[\x20-\x7e]+$/.test(s) ? s : null;
  } catch {
    return null;
  }
}

export function encodeMemoBody(body: MemoBody): Hex {
  const json = JSON.stringify(body);
  if (json.length > 600) throw new Error("memo too long");
  return stringToHex(json);
}

export function decodeMemoBody(hex: Hex): { text: string; body: MemoBody | null } {
  let text = "";
  try {
    text = hexToString(hex);
  } catch {
    return { text: "", body: null };
  }
  try {
    const b = JSON.parse(text) as MemoBody;
    return { text, body: b && b.v === 1 ? b : null };
  } catch {
    return { text, body: null };
  }
}

/** Calldata for Memo.memo wrapping a call to `target`. */
export function memoCall(target: Address, data: Hex, ref: string, body: MemoBody): { target: Address; callData: Hex } {
  return {
    target: ARC_MEMO,
    callData: encodeFunctionData({ abi: memoAbi, functionName: "memo", args: [target, data, memoIdFor(ref), encodeMemoBody(body)] }),
  };
}

export type DecodedMemoLog =
  | { kind: "before"; memoIndex: bigint; logIndex: number; txHash: Hex; blockNumber: bigint }
  | {
      kind: "memo";
      memoIndex: bigint;
      logIndex: number;
      txHash: Hex;
      blockNumber: bigint;
      sender: Address;
      target: Address;
      memoId: Hex;
      memo: Hex;
    };

export function decodeMemoLog(log: { topics: Hex[]; data: Hex; logIndex: number; transactionHash: Hex; blockNumber: bigint }): DecodedMemoLog | null {
  try {
    const ev = decodeEventLog({ abi: memoAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data });
    if (ev.eventName === "BeforeMemo") {
      return { kind: "before", memoIndex: ev.args.memoIndex, logIndex: log.logIndex, txHash: log.transactionHash, blockNumber: log.blockNumber };
    }
    if (ev.eventName === "Memo") {
      return {
        kind: "memo",
        memoIndex: ev.args.memoIndex,
        logIndex: log.logIndex,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        sender: ev.args.sender,
        target: ev.args.target,
        memoId: ev.args.memoId,
        memo: ev.args.memo,
      };
    }
  } catch {
    /* not a memo log */
  }
  return null;
}
