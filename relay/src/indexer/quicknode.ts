import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { Address, Hex } from "viem";
import type { RawLog } from "./ingest";

/**
 * QuickNode Streams webhook support.
 *
 * Signature (per QuickNode's "validating incoming Streams webhook messages" guide):
 *   X-QN-Signature = hex(HMAC-SHA256(securityToken, nonce + timestamp + decodedBody))
 * with nonce/timestamp from the X-QN-Nonce / X-QN-Timestamp headers.
 */
export function verifyStreamsSignature(
  token: string,
  body: string,
  headers: { nonce: string | null; timestamp: string | null; signature: string | null },
): boolean {
  const { nonce, timestamp, signature } = headers;
  if (!nonce || !timestamp || !signature) return false;
  const expected = createHmac("sha256", token).update(nonce + timestamp + body).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Request bodies may be gzip-compressed (destination setting "Gzip"). */
export function decodeBody(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  return (isGzip ? gunzipSync(buf) : buf).toString("utf8");
}

const toBig = (v: unknown): bigint | null => {
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string" && v.length) return BigInt(v); // handles "0x.." and decimal strings
  return null;
};

function isLogLike(x: Record<string, unknown>): boolean {
  return (
    typeof x.address === "string" &&
    Array.isArray(x.topics) &&
    typeof x.data === "string" &&
    x.transactionHash !== undefined &&
    x.logIndex !== undefined &&
    x.blockNumber !== undefined
  );
}

/**
 * Extracts logs for `vault` from any Streams payload shape: the raw `logs` dataset
 * (`{ data: [[[log]]], metadata }`; docs show varying nesting depth), the `receipts` dataset
 * (receipts with a `logs` array), or the output of our filter (`{ logs: [...] }`).
 * Logs flagged `removed: true` are skipped.
 */
export function extractStreamsLogs(payload: unknown, vault: Address): RawLog[] {
  const want = vault.toLowerCase();
  const out: RawLog[] = [];
  const seen = new Set<string>();
  const walk = (x: unknown, depth: number) => {
    if (depth > 8 || x === null || typeof x !== "object") return;
    if (Array.isArray(x)) {
      for (const item of x) walk(item, depth + 1);
      return;
    }
    const o = x as Record<string, unknown>;
    if (isLogLike(o)) {
      if ((o.address as string).toLowerCase() !== want || o.removed === true) return;
      const blockNumber = toBig(o.blockNumber);
      const logIndex = toBig(o.logIndex);
      if (blockNumber === null || logIndex === null) return;
      const key = `${(o.transactionHash as string).toLowerCase()}:${logIndex}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        address: o.address as Address,
        topics: o.topics as Hex[],
        data: o.data as Hex,
        blockNumber,
        transactionHash: o.transactionHash as Hex,
        logIndex: Number(logIndex),
      });
      return;
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(payload, 0);
  return out;
}

/**
 * Block range of a delivery: our filter's `batchStart`/`batchEnd`, or QuickNode's
 * `metadata.batch_start_range`/`batch_end_range` (decimal or hex).
 */
export function extractBatchRange(payload: unknown): { start: bigint | null; end: bigint | null } {
  const o = (payload ?? {}) as Record<string, unknown>;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    try {
      return v === null || v === undefined || v === "" ? null : toBig(v);
    } catch {
      return null;
    }
  };
  return {
    start: num(o.batchStart) ?? num(meta.batch_start_range),
    end: num(o.batchEnd) ?? num(meta.batch_end_range),
  };
}

/**
 * Recommended Streams filter (dataset "logs"). It always returns an object, so every batch
 * reaches the webhook: the delivery doubles as a clock that drives the relay tick.
 * Replace VAULT before pasting into the QuickNode dashboard.
 */
export const STREAMS_FILTER_TEMPLATE = `function main(stream) {
  const VAULT = "<VAULT_ADDRESS_LOWERCASE>";
  const logs = [];
  const walk = (x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x && typeof x === "object" && Array.isArray(x.topics) && typeof x.address === "string") {
      if (x.address.toLowerCase() === VAULT) logs.push(x);
    }
  };
  walk(stream.data);
  const m = stream.metadata || {};
  return { logs: logs, batchStart: m.batch_start_range ?? null, batchEnd: m.batch_end_range ?? null };
}`;
