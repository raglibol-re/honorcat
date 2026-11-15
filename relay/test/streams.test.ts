import { beforeAll, describe, expect, it } from "vitest";
import { resetConfig } from "../src/config";
import { memoryDb } from "../src/db";
import { recordBatch, streamsOverview } from "../src/streams";

beforeAll(() => {
  process.env.VAULT_ADDRESS = "0x1111111111111111111111111111111111111111";
  process.env.VAULT_DEPLOY_BLOCK = "1";
  resetConfig();
});

describe("streams overview", () => {
  it("reports the last delivery even when a polling client has already seen every batch", async () => {
    const db = await memoryDb();
    expect((await streamsOverview(db)).lastBatch).toBeNull();
    await recordBatch(db, { start: null, end: null, bytes: 53, gzip: false, logs: 0, inserted: 0, events: [] });
    const first = await streamsOverview(db);
    expect(first.lastBatch).not.toBeNull();
    const seen = Math.max(...first.batches.map((b) => Number(b.id)));
    // Between deliveries the client asks for batches newer than the last one it has: none.
    const between = await streamsOverview(db, { since: seen });
    expect(between.batches).toHaveLength(0);
    expect(between.lastBatch?.receivedAt).toBe(first.lastBatch?.receivedAt);
  }, 30_000);
});
