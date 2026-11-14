import type { Hex } from "viem";
import type { Db } from "../db";
import type { ResultSource } from "./types";

/** Outcomes set by an operator through the admin API. For tests and demos. */
export class ManualSource implements ResultSource {
  readonly name = "manual";
  constructor(private readonly db: Db) {}

  async getOutcome(conditionId: Hex): Promise<boolean | null> {
    const rows = await this.db.query<{ outcome: boolean }>(
      "SELECT outcome FROM manual_outcomes WHERE condition_id = $1",
      [conditionId.toLowerCase()],
    );
    return rows[0]?.outcome ?? null;
  }

  async setOutcome(conditionId: Hex, outcome: boolean): Promise<void> {
    await this.db.query(
      `INSERT INTO manual_outcomes (condition_id, outcome) VALUES ($1, $2)
       ON CONFLICT (condition_id) DO UPDATE SET outcome = EXCLUDED.outcome, set_at = now()`,
      [conditionId.toLowerCase(), outcome],
    );
  }
}
