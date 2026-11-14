import { beforeAll, describe, expect, it } from "vitest";
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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verdictVaultAbi } from "../src/abi";
import { nativeToUsdcUnits, ARC_MIN_BASE_FEE } from "../src/arc";
import { conditionIdFor, registerCondition } from "../src/conditions";
import { resetConfig, usdcUnits } from "../src/config";
import { getState, memoryDb, scopeToVault, setState } from "../src/db";
import { authorizationTypedData, createNonce, fundNonce, potParamsHash, type PotParams } from "../src/gasless";
import { ingestLogs, type RawLog } from "../src/indexer/ingest";
import { authenticate, createIntegration, updateIntegration } from "../src/integrations";
import { ApiSource } from "../src/sources/api";
import { canonicalHttpKey, HttpSource, isPrivateAddress, outcomeFromValue, parseHttpKey, readPath } from "../src/sources/http";
import { deliverDueWebhooks, enqueuePing, listDeliveries, signPayload, verifyWebhookSignature } from "../src/webhooks";

const VAULT = getAddress("0x1111111111111111111111111111111111111111");
const ALICE = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const BOB = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

beforeAll(() => {
  process.env.VAULT_ADDRESS = VAULT;
  process.env.VAULT_DEPLOY_BLOCK = "1";
  resetConfig();
});

let logIdx = 0;
function log(eventName: string, args: Record<string, unknown>, block: bigint): RawLog {
  const item = getAbiItem({ abi: verdictVaultAbi, name: eventName as never }) as unknown as {
    inputs: { name: string; type: string; indexed?: boolean }[];
  };
  const nonIndexed = item.inputs.filter((i) => !i.indexed);
  const i = logIdx++;
  return {
    address: VAULT,
    topics: encodeEventTopics({ abi: verdictVaultAbi, eventName: eventName as never, args: args as never }) as Hex[],
    data: encodeAbiParameters(nonIndexed as never, nonIndexed.map((x) => args[x.name]) as never),
    blockNumber: block,
    transactionHash: keccak256(stringToBytes(`tx-${i}`)),
    logIndex: i,
  };
}
const blockTime = async (n: bigint) => 1_700_000_000 + Number(n);

function okFetch(calls: { url: string; init: RequestInit }[], status = 200): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("ok", { status });
  }) as unknown as typeof fetch;
}

describe("Arc units", () => {
  it("converts 18-decimal gas cost to 6-decimal USDC, rounding up", () => {
    expect(nativeToUsdcUnits(10n ** 12n)).toBe(1n);
    expect(nativeToUsdcUnits(10n ** 12n + 1n)).toBe(2n);
    expect(nativeToUsdcUnits(0n)).toBe(0n);
    // 100k gas at the 20 gwei floor = 0.002 USDC
    expect(nativeToUsdcUnits(100_000n * ARC_MIN_BASE_FEE)).toBe(2000n);
    expect(usdcUnits("1.5")).toBe(1_500_000n);
    expect(usdcUnits("0.000001")).toBe(1n);
  });
});

describe("gasless authorizations", () => {
  const params: PotParams = {
    conditionId: conditionIdFor("api", "order-1"),
    resolver: ALICE,
    payees: [ALICE, BOB],
    sharesBps: [6000, 4000],
    refundTo: BOB,
    deadline: 2_000_000_000n,
  };
  const salt = keccak256(stringToBytes("salt"));

  it("binds nonces to pot, vault, chain and every parameter", () => {
    expect(fundNonce(5042002, VAULT, 1n, salt)).not.toBe(fundNonce(5042002, VAULT, 2n, salt));
    expect(fundNonce(5042002, VAULT, 1n, salt)).not.toBe(fundNonce(1, VAULT, 1n, salt));
    expect(fundNonce(5042002, VAULT, 1n, salt)).not.toBe(fundNonce(5042002, ALICE, 1n, salt));
    const base = createNonce(5042002, VAULT, params, salt);
    expect(createNonce(5042002, VAULT, { ...params, payees: [ALICE, ALICE] }, salt)).not.toBe(base);
    expect(createNonce(5042002, VAULT, { ...params, sharesBps: [4000, 6000] }, salt)).not.toBe(base);
    expect(createNonce(5042002, VAULT, { ...params, refundTo: ALICE }, salt)).not.toBe(base);
    expect(createNonce(5042002, VAULT, { ...params, deadline: 1n }, salt)).not.toBe(base);
    // checksum vs lowercase addresses hash the same
    expect(potParamsHash({ ...params, payees: params.payees.map((a) => a.toLowerCase() as Address) })).toBe(
      potParamsHash(params),
    );
  });

  it("produces typed data a wallet can sign and the relay can recover", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const td = authorizationTypedData({
      domain: { name: "USDC", version: "2", chainId: 5042002, verifyingContract: "0x3600000000000000000000000000000000000000" },
      from: acct.address,
      vault: VAULT,
      value: 1_000_000n,
      validAfter: 0n,
      validBefore: 9_999_999_999n,
      nonce: fundNonce(5042002, VAULT, 1n, salt),
    });
    const signature = await acct.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(acct.address);
  });
});

describe("integrations, api source and webhooks", () => {
  it("authenticates keys, revokes them, and isolates api conditions per integration", async () => {
    const db = await memoryDb();
    const a = await createIntegration(db, { name: "shop" });
    const b = await createIntegration(db, { name: "other" });
    expect(a.apiKey).toMatch(/^vk_[0-9a-f]{12}_/);
    expect((await authenticate(db, `Bearer ${a.apiKey}`))?.id).toBe(a.integration.id);
    expect(await authenticate(db, `Bearer ${a.apiKey}x`)).toBeNull();
    expect(await authenticate(db, `Bearer ${a.apiKey.replace(a.integration.id, b.integration.id)}`)).toBeNull();
    expect(await authenticate(db, null)).toBeNull();

    const cond = await registerCondition(db, "api", "order-1", "Order 1 delivered", a.integration.id);
    const src = new ApiSource(db);
    expect(await src.getOutcome(cond.conditionId)).toBeNull();
    await expect(src.report(cond.conditionId, true, b.integration.id)).rejects.toThrow(/another integration/);
    expect(await src.report(cond.conditionId, true, a.integration.id)).toEqual({ outcome: true, changed: true });
    expect(await src.report(cond.conditionId, true, a.integration.id)).toEqual({ outcome: true, changed: false });
    await expect(src.report(cond.conditionId, false, a.integration.id)).rejects.toThrow(/already reported/);
    expect(await src.getOutcome(cond.conditionId)).toBe(true);

    await updateIntegration(db, a.integration.id, { revoke: true });
    expect(await authenticate(db, `Bearer ${a.apiKey}`)).toBeNull();
  });

  it("enqueues signed webhooks for the owner's pots on ingestion and retries with backoff", async () => {
    const db = await memoryDb();
    const { integration, webhookSecret } = await createIntegration(db, { name: "shop", webhookUrl: "https://hooks.example/verdict" });
    const owned = await registerCondition(db, "api", "order-7", undefined, integration.id);
    const foreign = conditionIdFor("manual", "x");

    const created = (potId: bigint, conditionId: Hex, block: bigint) =>
      log(
        "PotCreated",
        { potId, conditionId, creator: ALICE, resolver: ALICE, refundTo: BOB, deadline: 2_000_000_000n, payees: [ALICE], sharesBps: [10000] },
        block,
      );
    await ingestLogs(
      db,
      VAULT,
      [created(1n, owned.conditionId, 10n), log("PotFunded", { potId: 1n, funder: BOB, amount: 5n, newTotal: 5n }, 11n), created(2n, foreign, 12n)],
      "test",
      blockTime,
    );
    let rows = await listDeliveries(db, integration.id);
    expect(rows.map((r) => r.event_type).sort()).toEqual(["pot.created", "pot.funded"]);
    expect(rows.every((r) => r.pot_id === "1")).toBe(true);

    // re-ingesting the same logs does not duplicate deliveries
    const fail: { url: string; init: RequestInit }[] = [];
    expect(await deliverDueWebhooks(db, { fetchImpl: okFetch(fail, 500) })).toEqual({ delivered: 0, failed: 2 });
    rows = await listDeliveries(db, integration.id);
    expect(rows.every((r) => r.attempts === 1 && r.last_status === 500 && !r.delivered_at)).toBe(true);
    // backoff: not due again immediately
    expect(await deliverDueWebhooks(db, { fetchImpl: okFetch(fail, 200) })).toEqual({ delivered: 0, failed: 0 });

    await db.query("UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second'");
    const ok: { url: string; init: RequestInit }[] = [];
    expect(await deliverDueWebhooks(db, { fetchImpl: okFetch(ok) })).toEqual({ delivered: 2, failed: 0 });
    const first = ok[0]!;
    const headers = first.init.headers as Record<string, string>;
    expect(first.url).toBe("https://hooks.example/verdict");
    expect(verifyWebhookSignature(webhookSecret, headers["verdict-signature"], first.init.body as string)).toBe(true);
    expect(verifyWebhookSignature("whsec_wrong", headers["verdict-signature"], first.init.body as string)).toBe(false);
    const body = JSON.parse(first.init.body as string);
    expect(body).toMatchObject({ type: "pot.created", potId: "1", chainId: 5042002 });
    expect(headers["verdict-event-id"]).toBe(body.id);

    await enqueuePing(db, integration.id);
    expect((await deliverDueWebhooks(db, { fetchImpl: okFetch([]) })).delivered).toBe(1);
  });

  it("rejects stale or tampered webhook signatures", () => {
    const body = '{"a":1}';
    const header = signPayload("s", body, 1000);
    expect(verifyWebhookSignature("s", header, body, 300, 1100)).toBe(true);
    expect(verifyWebhookSignature("s", header, body, 300, 2000)).toBe(false);
    expect(verifyWebhookSignature("s", header, '{"a":2}', 300, 1100)).toBe(false);
    expect(verifyWebhookSignature("s", "garbage", body)).toBe(false);
  });
});

describe("http source", () => {
  it("parses, canonicalises and evaluates specs", async () => {
    const key = '{ "url":"https://api.example/x", "yes":"won", "no":"lost", "path":"data.0.result" }';
    expect(canonicalHttpKey(key)).toBe('{"no":"lost","path":"data.0.result","url":"https://api.example/x","yes":"won"}');
    expect(() => parseHttpKey('{"url":"https://a.b","yes":1,"no":1}')).toThrow();
    expect(() => parseHttpKey('{"url":"https://a.b","yes":1,"no":2,"extra":true}')).toThrow();
    const spec = parseHttpKey(key);
    expect(readPath({ data: [{ result: "won" }] }, spec.path)).toBe("won");
    expect(outcomeFromValue(spec, "won")).toBe(true);
    expect(outcomeFromValue(spec, "lost")).toBe(false);
    expect(outcomeFromValue(spec, "pending")).toBeNull();
    expect(outcomeFromValue(spec, undefined)).toBeNull();
  });

  it("blocks private and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses http and private hosts unless explicitly allowed", async () => {
    const db = await memoryDb();
    const src = new HttpSource(db, { allowInsecure: false });
    await expect(src.describe('{"url":"http://example.com","yes":1,"no":2}')).rejects.toThrow(/https/);
    await expect(src.describe('{"url":"https://127.0.0.1/x","yes":1,"no":2}')).rejects.toThrow(/non-public/);
  });

  it("resolves a registered condition through the fetched JSON", async () => {
    const db = await memoryDb();
    const fetchImpl = (async () => Response.json({ match: { status: "home_win" } })) as unknown as typeof fetch;
    const src = new HttpSource(db, { allowInsecure: true, fetchImpl });
    const key = src.normalizeKey('{"url":"https://scores.example/m/1","path":"match.status","yes":"home_win","no":"away_win"}');
    await registerCondition(db, "http", key);
    expect(await src.getOutcome(conditionIdFor("http", key))).toBe(true);
  });
});

describe("vault scoping", () => {
  it("drops indexed history when the vault address changes, keeps conditions", async () => {
    const db = await memoryDb();
    expect(await scopeToVault(db, VAULT)).toBe(false);
    await registerCondition(db, "manual", "keep-me");
    await ingestLogs(db, VAULT, [log("PotFunded", { potId: 9n, funder: BOB, amount: 1n, newTotal: 1n }, 5n)], "t", blockTime);
    await setState(db, "rpc_last_indexed_block", "5");
    expect(await scopeToVault(db, VAULT)).toBe(false);
    expect(await scopeToVault(db, ALICE)).toBe(true);
    expect((await db.query("SELECT 1 FROM chain_events")).length).toBe(0);
    expect(await getState(db, "rpc_last_indexed_block")).toBeUndefined();
    expect(await getState(db, "vault")).toBe(ALICE.toLowerCase());
    expect((await db.query("SELECT 1 FROM conditions")).length).toBe(1);
  });
});
