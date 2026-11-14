import type { Hex } from "viem";
import { getCondition } from "../conditions";
import type { Db } from "../db";
import type { ResultSource } from "./types";

/**
 * Gemini prediction markets (public REST, no API key).
 *
 * Condition key: "<eventTicker>:<contractTicker>", e.g. "SOL05M2611141625:UP".
 * Endpoint: GET {base}/v1/prediction-markets/events/{eventTicker} (returns the Event object).
 * Mapping, per contract:
 *   status == "settled" && resolutionSide == "yes" -> true
 *   status == "settled" && resolutionSide == "no"  -> false
 *   anything else (active, closed, under_review, invalid, missing) -> null
 * A contract that is never settled (e.g. "invalid") leaves the pot to expire and refund.
 */
export type GeminiContract = { ticker: string; status: string; resolutionSide?: string | null; label?: string };
export type GeminiEvent = { ticker: string; title?: string; status: string; contracts?: GeminiContract[] };
type Fetch = typeof fetch;

export function parseGeminiKey(key: string): { eventTicker: string; contractTicker: string } | null {
  const m = /^([A-Za-z0-9_.-]{1,100}):([A-Za-z0-9_.-]{1,100})$/.exec(key);
  return m ? { eventTicker: m[1]!, contractTicker: m[2]! } : null;
}

export function outcomeFromContract(c: GeminiContract | undefined): boolean | null {
  if (!c || c.status !== "settled") return null;
  if (c.resolutionSide === "yes") return true;
  if (c.resolutionSide === "no") return false;
  return null;
}

export class GeminiSource implements ResultSource {
  readonly name = "gemini";
  /** Per-instance cache so one tick fetches each event once. Sources are rebuilt every tick. */
  private readonly events = new Map<string, Promise<GeminiEvent | null>>();

  constructor(
    private readonly db: Db,
    private readonly base = "https://api.gemini.com",
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async fetchEvent(eventTicker: string): Promise<GeminiEvent | null> {
    let p = this.events.get(eventTicker);
    if (!p) {
      p = (async () => {
        const url = `${this.base}/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`;
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`gemini ${res.status} for ${eventTicker}`);
        return (await res.json()) as GeminiEvent;
      })();
      this.events.set(eventTicker, p);
    }
    return p;
  }

  async getOutcome(conditionId: Hex): Promise<boolean | null> {
    const cond = await getCondition(this.db, conditionId);
    if (!cond || cond.source !== this.name) return null;
    const k = parseGeminiKey(cond.key);
    if (!k) return null;
    const ev = await this.fetchEvent(k.eventTicker);
    return outcomeFromContract(ev?.contracts?.find((c) => c.ticker === k.contractTicker));
  }

  /** Checks at registration time that the market exists; returns a readable label. */
  async describe(key: string): Promise<string> {
    const k = parseGeminiKey(key);
    if (!k) throw new Error("gemini key must be '<eventTicker>:<contractTicker>'");
    const ev = await this.fetchEvent(k.eventTicker);
    const c = ev?.contracts?.find((x) => x.ticker === k.contractTicker);
    if (!ev || !c) throw new Error(`no Gemini contract ${k.contractTicker} in event ${k.eventTicker}`);
    return `${ev.title ?? ev.ticker} — ${c.label ?? c.ticker}`;
  }
}
