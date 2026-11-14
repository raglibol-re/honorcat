import type { Hex } from "viem";

/**
 * A pluggable source of truth for external events.
 * Returns `true`/`false` once the event has a final result, or `null` while it is unknown
 * (not settled yet, voided, unknown condition, ...). `null` never triggers an on-chain action.
 */
export interface ResultSource {
  readonly name: string;
  getOutcome(conditionId: Hex): Promise<boolean | null>;
}
