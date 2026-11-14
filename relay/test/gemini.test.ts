import { describe, expect, it } from "vitest";
import { conditionIdFor, registerCondition } from "../src/conditions";
import { memoryDb } from "../src/db";
import { GeminiSource, outcomeFromContract, parseGeminiKey, type GeminiEvent } from "../src/sources/gemini";

/** Shape taken from a live GET /v1/prediction-markets/events/{ticker} response (trimmed). */
const event = (contracts: GeminiEvent["contracts"]): GeminiEvent => ({ ticker: "EVT1", title: "Test event", status: "settled", contracts });

function fakeFetch(body: GeminiEvent | null, calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(String(url));
    if (!body) return new Response("not found", { status: 404 });
    return Response.json(body);
  }) as unknown as typeof fetch;
}

describe("GeminiSource", () => {
  it("parses keys", () => {
    expect(parseGeminiKey("SOL05M2611141625:UP")).toEqual({ eventTicker: "SOL05M2611141625", contractTicker: "UP" });
    expect(parseGeminiKey("no-colon")).toBeNull();
    expect(parseGeminiKey("a:b:c")).toBeNull();
    expect(parseGeminiKey("../x:UP")).toBeNull();
  });

  it("maps settlement fields to outcomes", () => {
    expect(outcomeFromContract({ ticker: "UP", status: "settled", resolutionSide: "yes" })).toBe(true);
    expect(outcomeFromContract({ ticker: "UP", status: "settled", resolutionSide: "no" })).toBe(false);
    expect(outcomeFromContract({ ticker: "UP", status: "closed", resolutionSide: "yes" })).toBeNull();
    expect(outcomeFromContract({ ticker: "UP", status: "under_review", resolutionSide: "no" })).toBeNull();
    expect(outcomeFromContract({ ticker: "UP", status: "invalid" })).toBeNull();
    expect(outcomeFromContract({ ticker: "UP", status: "settled" })).toBeNull();
    expect(outcomeFromContract(undefined)).toBeNull();
  });

  it("resolves a registered condition and fetches each event once per instance", async () => {
    const db = await memoryDb();
    const calls: string[] = [];
    const src = new GeminiSource(
      db,
      "https://example.test",
      fakeFetch(event([{ ticker: "UP", status: "settled", resolutionSide: "yes" }, { ticker: "DOWN", status: "settled", resolutionSide: "no" }]), calls),
    );
    await registerCondition(db, "gemini", "EVT1:UP");
    await registerCondition(db, "gemini", "EVT1:DOWN");
    expect(await src.getOutcome(conditionIdFor("gemini", "EVT1:UP"))).toBe(true);
    expect(await src.getOutcome(conditionIdFor("gemini", "EVT1:DOWN"))).toBe(false);
    expect(calls).toEqual(["https://example.test/v1/prediction-markets/events/EVT1"]);
  });

  it("returns null for unknown conditions, other sources, missing contracts and 404s", async () => {
    const db = await memoryDb();
    await registerCondition(db, "gemini", "EVT1:MISSING");
    await registerCondition(db, "manual", "EVT1:UP");
    const src = new GeminiSource(db, "https://example.test", fakeFetch(event([{ ticker: "UP", status: "settled", resolutionSide: "yes" }])));
    expect(await src.getOutcome(conditionIdFor("gemini", "EVT1:MISSING"))).toBeNull();
    expect(await src.getOutcome(conditionIdFor("manual", "EVT1:UP"))).toBeNull();
    expect(await src.getOutcome(conditionIdFor("gemini", "never-registered:UP"))).toBeNull();
    const gone = new GeminiSource(db, "https://example.test", fakeFetch(null));
    await registerCondition(db, "gemini", "GONE:UP");
    expect(await gone.getOutcome(conditionIdFor("gemini", "GONE:UP"))).toBeNull();
  });

  it("describe() validates the market exists", async () => {
    const db = await memoryDb();
    const src = new GeminiSource(db, "https://example.test", fakeFetch(event([{ ticker: "UP", label: "Up", status: "active" }])));
    expect(await src.describe("EVT1:UP")).toBe("Test event — Up");
    await expect(src.describe("EVT1:DOWN")).rejects.toThrow(/no Gemini contract/);
    await expect(src.describe("bad")).rejects.toThrow(/eventTicker/);
  });

  it.runIf(process.env.GEMINI_LIVE === "1")("live: a recently settled contract maps to a boolean", async () => {
    const res = await fetch("https://api.gemini.com/v1/prediction-markets/events/recently-settled");
    const { data } = (await res.json()) as { data: GeminiEvent[] };
    const ev = data.find((e) => e.contracts?.some((c) => c.status === "settled"))!;
    const c = ev.contracts!.find((x) => x.status === "settled")!;
    const db = await memoryDb();
    await registerCondition(db, "gemini", `${ev.ticker}:${c.ticker}`);
    const out = await new GeminiSource(db).getOutcome(conditionIdFor("gemini", `${ev.ticker}:${c.ticker}`));
    expect(out).toBe(c.resolutionSide === "yes");
  });
});
