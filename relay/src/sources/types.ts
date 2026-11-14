import type { Hex } from "viem";

/**
 * A pluggable source of truth for external events.
 * Returns `true`/`false` once the event has a final result, or `null` while it is unknown
 * (not settled yet, voided, unknown condition, ...). `null` never triggers an on-chain action.
 */
export interface ResultSource {
  readonly name: string;
  getOutcome(conditionId: Hex): Promise<boolean | null>;
  /** Optional: validate a condition key at registration and return a human-readable label. */
  describe?(key: string): Promise<string>;
  /** Optional: canonical form of a key, applied before the conditionId is derived. */
  normalizeKey?(key: string): string;
  /** True if registering requires an integration (API key), e.g. outcomes reported by that app. */
  readonly requiresOwner?: boolean;
}
