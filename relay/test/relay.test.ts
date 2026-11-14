import { createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  keccak256,
  recoverTypedDataAddress,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verdictVaultAbi } from "../src/abi";
import { conditionIdFor, registerCondition } from "../src/conditions";
import { memoryDb } from "../src/db";
import { ingestLogs, type RawLog } from "../src/indexer/ingest";
import { decodeBody, extractBatchRange, extractStreamsLogs, verifyStreamsSignature } from "../src/indexer/quicknode";
import { listPayments, listPots, getPotDetail } from "../src/api";
import { ManualSource } from "../src/sources/manual";
import { resolutionDomain, resolutionTypes, signResolution } from "../src/signer";

const VAULT = getAddress("0x1111111111111111111111111111111111111111");
const ALICE = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const BOB = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const REFUND = getAddress("0xcccccccccccccccccccccccccccccccccccccccc");
const RESOLVER = getAddress("0xdddddddddddddddddddddddddddddddddddddddd");
const COND = conditionIdFor("manual", "demo-1");

let logCounter = 0;

/** Encodes a VerdictVault event the way the chain would emit it. */
function makeLog(eventName: string, args: Record<string, unknown>, blockNumber: bigint, tx?: Hex): RawLog {
  const item = getAbiItem({ abi: verdictVaultAbi, name: eventName as never }) as unknown as {
    inputs: { name: string; type: string; indexed?: boolean }[];
  };
  const topics = encodeEventTopics({ abi: verdictVaultAbi, eventName: eventName as never, args: args as never });
  const nonIndexed = item.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => args[i.name]) as never);
  const idx = logCounter++;
  return {
    address: VAULT,
    topics: topics as Hex[],
    data,
    blockNumber,
    transactionHash: tx ?? keccak256(stringToBytes(`tx-${idx}`)),
    logIndex: idx,
  };
}

const blockTime = async (n: bigint) => 1_700_000_000 + Number(n);

function lifecycle(outcome: boolean): RawLog[] {
  const created = makeLog(
    "PotCreated",
    {
      potId: 1n,
      conditionId: COND,
      creator: ALICE,
      resolver: RESOLVER,
      refundTo: REFUND,
      deadline: 2_000_000_000n,
      payees: [ALICE, BOB],
      sharesBps: [7000, 3000],
    },
    10n,
  );
  const funded1 = makeLog("PotFunded", { potId: 1n, funder: ALICE, amount: 60_000_000n, newTotal: 60_000_000n }, 11n);
  const funded2 = makeLog("PotFunded", { potId: 1n, funder: BOB, amount: 40_000_000n, newTotal: 100_000_000n }, 12n);
  const settleTx = keccak256(stringToBytes(`settle-${outcome}`));
  const resolved = makeLog(
    "PotResolved",
    { potId: 1n, outcome, total: 100_000_000n, submitter: RESOLVER },
    13n,
    settleTx,
  );
  const pays = outcome
    ? [
        makeLog("Payout", { potId: 1n, payee: ALICE, amount: 70_000_000n }, 13n, settleTx),
        makeLog("PaymentDeferred", { potId: 1n, recipient: BOB, amount: 30_000_000n, kind: 0 }, 13n, settleTx),
      ]
    : [makeLog("Refund", { potId: 1n, refundTo: REFUND, amount: 100_000_000n }, 13n, settleTx)];
  return [created, funded1, funded2, resolved, ...pays];
}

describe("indexer ingest + projection", () => {
  it("projects a resolved pot and exposes payments", async () => {
    const db = await memoryDb();
    await registerCondition(db, "manual", "demo-1", "Demo");
    const res = await ingestLogs(db, VAULT, lifecycle(true), "rpc", blockTime);
    expect(res.inserted).toBe(6);

    const [pot] = await listPots(db);
    expect(pot).toMatchObject({
      potId: 1,
      status: "resolved",
      outcome: true,
      total: "100000000",
      fundingCount: 2,
      payees: [
        { address: ALICE.toLowerCase(), shareBps: 7000 },
        { address: BOB.toLowerCase(), shareBps: 3000 },
      ],
      condition: { source: "manual", key: "demo-1", label: "Demo" },
    });

    const payments = await listPayments(db);
    expect(payments.map((p) => [p.kind, p.recipient, p.amount])).toEqual([
      ["payout_deferred", BOB.toLowerCase(), "30000000"],
      ["payout", ALICE.toLowerCase(), "70000000"],
    ]);
    expect(payments[0]!.time).toBe(1_700_000_013);
  });

  it("is idempotent and order-independent across sources", async () => {
    const db = await memoryDb();
    const logs = lifecycle(false);
    // Streams delivers the tail first, RPC poller later delivers everything again.
    await ingestLogs(db, VAULT, logs.slice(2), "streams", blockTime);
    expect(await listPots(db)).toHaveLength(0); // creation not seen yet
    const again = await ingestLogs(db, VAULT, logs, "rpc", blockTime);
    expect(again.inserted).toBe(2);

    const detail = await getPotDetail(db, 1);
    expect(detail?.pot.status).toBe("resolved");
    expect(detail?.pot.outcome).toBe(false);
    expect(detail?.pot.total).toBe("100000000");
    expect(detail?.events).toHaveLength(5);
    expect(detail?.payments).toEqual([
      expect.objectContaining({ kind: "refund", recipient: REFUND.toLowerCase(), amount: "100000000" }),
    ]);
  });

  it("ignores logs from other contracts", async () => {
    const db = await memoryDb();
    const foreign = { ...lifecycle(true)[0]!, address: ALICE };
    const res = await ingestLogs(db, VAULT, [foreign], "rpc", blockTime);
    expect(res.inserted).toBe(0);
  });
});

describe("ManualSource", () => {
  it("returns null until an outcome is set", async () => {
    const db = await memoryDb();
    const src = new ManualSource(db);
    expect(await src.getOutcome(COND)).toBeNull();
    await src.setOutcome(COND, true);
    expect(await src.getOutcome(COND)).toBe(true);
    await src.setOutcome(COND, false);
    expect(await src.getOutcome(COND)).toBe(false);
  });
});

describe("conditions", () => {
  it("derives ids from source and key", () => {
    expect(conditionIdFor("manual", "x")).toBe(keccak256(stringToBytes("manual:x")));
    expect(conditionIdFor("manual", "x")).not.toBe(conditionIdFor("gemini", "x"));
  });
});

describe("signer", () => {
  it("produces an EIP-712 signature that recovers to the resolver", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const msg = { potId: 7n, conditionId: COND, outcome: true };
    const signature = await signResolution(account, { chainId: 5042002, vault: VAULT, ...msg });
    const recovered = await recoverTypedDataAddress({
      domain: resolutionDomain(5042002, VAULT),
      types: resolutionTypes,
      primaryType: "Resolution",
      message: msg,
      signature,
    });
    expect(recovered).toBe(account.address);
  });
});

describe("QuickNode Streams", () => {
  const token = "test-token-that-is-at-least-32-characters";

  it("verifies HMAC signatures over nonce + timestamp + body", () => {
    const body = JSON.stringify({ data: [] });
    const sig = createHmac("sha256", token).update("n1" + "1700000000" + body).digest("hex");
    const h = { nonce: "n1", timestamp: "1700000000", signature: sig };
    expect(verifyStreamsSignature(token, body, h)).toBe(true);
    expect(verifyStreamsSignature(token, body + " ", h)).toBe(false);
    expect(verifyStreamsSignature("other-token", body, h)).toBe(false);
    expect(verifyStreamsSignature(token, body, { ...h, signature: null })).toBe(false);
  });

  it("decodes gzip and plain bodies", () => {
    const text = '{"a":1}';
    expect(decodeBody(new TextEncoder().encode(text))).toBe(text);
    expect(decodeBody(gzipSync(text))).toBe(text);
  });

  const toWire = (l: RawLog, extra: Record<string, unknown> = {}) => ({
    address: l.address.toLowerCase(),
    topics: l.topics,
    data: l.data,
    blockNumber: `0x${l.blockNumber.toString(16)}`,
    transactionHash: l.transactionHash,
    logIndex: `0x${l.logIndex.toString(16)}`,
    removed: false,
    ...extra,
  });

  it("extracts our logs from logs, receipts and filtered payloads", () => {
    const logs = lifecycle(true);
    const wire = logs.map((l) => toWire(l));
    const other = { ...wire[0], address: "0x9999999999999999999999999999999999999999" };

    const logsDataset = { data: [[[wire[0], other], [wire[1]]], [[wire[2]]]], metadata: { batch_end_range: 13 } };
    expect(extractStreamsLogs(logsDataset, VAULT)).toHaveLength(3);

    const twoLevel = { data: [[wire[0], wire[1]]], metadata: {} };
    expect(extractStreamsLogs(twoLevel, VAULT)).toHaveLength(2);

    const receipts = { data: [[{ transactionHash: logs[3]!.transactionHash, status: "0x1", logs: wire.slice(3) }]] };
    expect(extractStreamsLogs(receipts, VAULT)).toHaveLength(3);

    const filtered = { logs: wire, batchEnd: 13 };
    const out = extractStreamsLogs(filtered, VAULT);
    expect(out).toHaveLength(wire.length);
    expect(out[0]!.blockNumber).toBe(10n);
    expect(typeof out[0]!.logIndex).toBe("number");

    const removed = { logs: [toWire(logs[0]!, { removed: true })] };
    expect(extractStreamsLogs(removed, VAULT)).toHaveLength(0);
  });

  it("feeds extracted logs into the same idempotent ingest", async () => {
    const db = await memoryDb();
    const wire = { logs: lifecycle(true).map((l) => toWire(l)) };
    const logs = extractStreamsLogs(wire, VAULT as Address);
    await ingestLogs(db, VAULT, logs, "streams", blockTime);
    const second = await ingestLogs(db, VAULT, logs, "streams", blockTime);
    expect(second.inserted).toBe(0);
    expect((await listPots(db))[0]?.status).toBe("resolved");
  });
});

describe("streams batch range", () => {
  it("reads our filter output and QuickNode metadata (decimal or hex)", () => {
    expect(extractBatchRange({ logs: [], batchStart: 100, batchEnd: 105 })).toEqual({ start: 100n, end: 105n });
    expect(extractBatchRange({ logs: [], batchEnd: "0x69" })).toEqual({ start: null, end: 105n });
    expect(extractBatchRange({ data: [], metadata: { batch_start_range: "7", batch_end_range: 9 } })).toEqual({ start: 7n, end: 9n });
    expect(extractBatchRange(null)).toEqual({ start: null, end: null });
    expect(extractBatchRange({ batchEnd: "not-a-number" })).toEqual({ start: null, end: null });
  });
});
