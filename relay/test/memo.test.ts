import { beforeAll, describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, stringToBytes, type Hex } from "viem";
import { guaranteeBookAbi } from "../src/abi";
import { ARC_MEMO } from "../src/arc";
import { resetConfig } from "../src/config";
import { memoryDb } from "../src/db";
import { ingestLogs, type RawLog } from "../src/indexer/ingest";
import { decodeMemoBody, encodeMemoBody, memoAbi, memoIdFor, memoIdText } from "../src/memo";

const VAULT = getAddress("0x1111111111111111111111111111111111111111");
const BOOK = getAddress("0x2222222222222222222222222222222222222222");
const RELAY = getAddress("0x3333333333333333333333333333333333333333");

beforeAll(() => {
  process.env.VAULT_ADDRESS = VAULT;
  process.env.VAULT_DEPLOY_BLOCK = "1";
  resetConfig();
});

describe("memo encoding", () => {
  it("keeps short references readable and hashes long ones", () => {
    const id = memoIdFor("guarantee-abc123");
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(memoIdText(id)).toBe("guarantee-abc123");
    const long = "x".repeat(40);
    expect(memoIdFor(long)).toBe(keccak256(stringToBytes(long)));
    expect(memoIdText(memoIdFor(long))).toBeNull();
  });

  it("round-trips the JSON body and rejects oversize memos", () => {
    const hex = encodeMemoBody({ v: 1, t: "payout", ref: "order-1", why: "Gemini settled \"Up\" YES" });
    expect(decodeMemoBody(hex).body).toMatchObject({ t: "payout", ref: "order-1" });
    expect(decodeMemoBody("0x6869" as Hex)).toEqual({ text: "hi", body: null });
    expect(() => encodeMemoBody({ v: 1, t: "fund", why: "x".repeat(700) })).toThrow(/too long/);
  });
});

function log(address: `0x${string}`, abi: unknown, eventName: string, args: Record<string, unknown>, logIndex: number, tx: Hex): RawLog {
  const item = (abi as { type: string; name: string; inputs: { name: string; type: string; indexed?: boolean }[] }[]).find(
    (x) => x.type === "event" && x.name === eventName,
  )!;
  const nonIndexed = item.inputs.filter((i) => !i.indexed);
  return {
    address,
    topics: encodeEventTopics({ abi: abi as never, eventName: eventName as never, args: args as never }) as Hex[],
    data: encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => args[i.name]) as never),
    blockNumber: 100n,
    transactionHash: tx,
    logIndex,
  };
}

describe("memo indexing", () => {
  it("stores memos for our transactions and ties them to the logs they wrap", async () => {
    const db = await memoryDb();
    const tx = keccak256(stringToBytes("tx-1"));
    const ref = "guarantee-g1";
    const body = encodeMemoBody({ v: 1, t: "refunds", ref, why: "Refund of 5.00 USDC each" });
    const customer = getAddress("0x4444444444444444444444444444444444444444");
    const logs: RawLog[] = [
      log(BOOK, guaranteeBookAbi, "GuaranteeOpened", { gid: 1n, potId: 7n, merchant: RELAY, refundAmount: 5_000_000n, maxCustomers: 3, lockTime: 9n }, 0, keccak256(stringToBytes("tx-0"))),
      log(ARC_MEMO, memoAbi, "BeforeMemo", { memoIndex: 42n }, 1, tx),
      log(BOOK, guaranteeBookAbi, "RefundPaid", { gid: 1n, account: customer, amount: 5_000_000n }, 2, tx),
      log(ARC_MEMO, memoAbi, "Memo", { sender: RELAY, target: BOOK, callDataHash: keccak256("0x"), memoId: (await import("../src/memo")).memoIdFor(ref), memo: body, memoIndex: 42n }, 3, tx),
      // a memo from someone else's tx in the same block is ignored
      log(ARC_MEMO, memoAbi, "Memo", { sender: RELAY, target: BOOK, callDataHash: keccak256("0x"), memoId: memoIdFor("x"), memo: body, memoIndex: 1n }, 4, keccak256(stringToBytes("other"))),
    ];
    const res = await ingestLogs(db, VAULT, logs, "test", async () => 1_700_000_000, { book: BOOK });
    expect(res.memos).toBe(1);
    const paid = await db.query<{ pot_id: string; gid: string }>(
      "SELECT pot_id::text AS pot_id, gid::text AS gid FROM chain_events WHERE event_name = 'RefundPaid'",
    );
    expect(paid[0]).toEqual({ pot_id: "7", gid: "1" }); // gid mapped to the pot via GuaranteeOpened
    const linked = await db.query<{ memo_text: string }>(
      `SELECT m.memo_text FROM memos m JOIN chain_events e ON e.tx_hash = m.tx_hash
       WHERE e.pot_id = 7 AND e.log_index > m.before_log_index AND e.log_index < m.log_index`,
    );
    expect(JSON.parse(linked[0]!.memo_text)).toMatchObject({ t: "refunds", ref });
    const pay = await db.query<{ kind: string; recipient: string }>("SELECT kind, recipient FROM payments");
    expect(pay).toEqual([{ kind: "guarantee_refund", recipient: customer.toLowerCase() }]);
  });
});
