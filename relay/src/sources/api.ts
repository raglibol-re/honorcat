import type { Hex } from "viem";
import { getCondition } from "../conditions";
import type { Db } from "../db";
import type { ResultSource } from "./types";

/**
 * Outcomes reported by the integration that owns the condition, through
 * `POST /api/v1/outcomes` with its API key. This is how an app built on Verdict plugs in its own
 * business event (delivery confirmed, milestone accepted, match finished, …) without code changes
 * in the relay. An outcome is final once reported; it cannot be flipped afterwards.
 */
export class ApiSource implements ResultSource {
  readonly name = "api";
  readonly requiresOwner = true;
  constructor(private readonly db: Db) {}

  async getOutcome(conditionId: Hex): Promise<boolean | null> {
    const rows = await this.db.query<{ outcome: boolean }>(
      `SELECT o.outcome FROM api_outcomes o JOIN conditions c ON c.condition_id = o.condition_id
       WHERE o.condition_id = $1 AND c.source = 'api' AND o.integration = c.owner`,
      [conditionId.toLowerCase()],
    );
    return rows[0]?.outcome ?? null;
  }

  /** Records the owner's outcome. Throws if the caller does not own it or tries to change it. */
  async report(conditionId: Hex, outcome: boolean, integration: string): Promise<{ outcome: boolean; changed: boolean }> {
    const cond = await getCondition(this.db, conditionId);
    if (!cond || cond.source !== this.name) throw Object.assign(new Error("unknown api condition"), { status: 404 });
    if (cond.owner !== integration) throw Object.assign(new Error("condition belongs to another integration"), { status: 403 });
    const rows = await this.db.query<{ outcome: boolean; inserted: boolean }>(
      `INSERT INTO api_outcomes (condition_id, outcome, integration) VALUES ($1, $2, $3)
       ON CONFLICT (condition_id) DO UPDATE SET condition_id = api_outcomes.condition_id
       RETURNING outcome, (xmax = 0) AS inserted`,
      [conditionId.toLowerCase(), outcome, integration],
    );
    const stored = rows[0]!;
    if (stored.outcome !== outcome) {
      throw Object.assign(new Error(`outcome already reported as ${stored.outcome}`), { status: 409 });
    }
    return { outcome, changed: stored.inserted };
  }
}
