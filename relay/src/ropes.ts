/**
 * HonorCat v2 (HonorCatRopes) in the relay: short ropes, knock-outs, expiries, extra lives, treats.
 *
 * Both contracts number their pots from 1, so the read model keeps v2 pots in their own range:
 * database pot id = ROPE_BASE + on-chain pot id. Everything that talks to the chain converts back
 * (`chainPotId`), and every window request records which contract it is for, so the samplers'
 * records, signed averages and the submitted attestation all name the right contract and pot.
 *
 * What the relay adds for v2 (docs/rope-design.md):
 * - knock-out: samplers watch every live rope's posts; when a sampler's own average over the last
 *   window is at or beyond a post it asks for that exact window (`openKnockWindow`), every sampler
 *   measures the same seconds, and the agreed attestation is submitted (`triggerKnockOut`). The pot
 *   then waits for its forward window like any exit (`resolveExit`).
 * - expiry: the expiry windows are fixed by the contract (expiry + 1 s, then up to three retries);
 *   the relay opens each one in time, the samplers measure it, the relay submits `resolveExpiry`, or
 *   `skipExpiryWindow` if no attestation came in time.
 * Anyone could submit the same attestations: the contract checks them, not the relay.
 */
import { getAddress, type Address } from "viem";
import { getConfig } from "./config";

/** The lowest v2 id range; each v2 deployment has its own range of one billion ids (v2.0: 1e9, v2.1: 2e9). */
export const ROPE_BASE = 1_000_000_000n;
const SPAN = 1_000_000_000n;
export const KIND_KNOCK = 7;
export const KIND_EXPIRY = 8;
export const EXPIRY_TRIES = 4;
export const ATTEST_TIMEOUT_S = 600;
export const P = 1_000_000;

/** Group pots (HonorCatGroups) live at 9e9 + their on-chain id in the same tables and requests. */
export const GROUP_BASE = 9_000_000_000n;
export const isGroupDbId = (dbId: string | bigint) => BigInt(dbId) >= GROUP_BASE;
export const groupDbId = (groupId: bigint | string) => (GROUP_BASE + BigInt(groupId)).toString();
export const isRopeDbId = (dbId: string | bigint) => BigInt(dbId) >= ROPE_BASE && BigInt(dbId) < GROUP_BASE;
/** The database id of a v2 pot: its deployment's id base (default: the current deployment) + its on-chain id. */
export const ropeDbId = (chainPotId: bigint | string, base?: bigint) => ((base ?? currentBase()) + BigInt(chainPotId)).toString();
/** The contract's own pot id for a database pot id (v1 ids are the same in both). */
export const chainPotId = (dbId: string | bigint) => (BigInt(dbId) >= ROPE_BASE ? BigInt(dbId) % SPAN : BigInt(dbId));
/** The id base of a database pot id's deployment. */
export const baseOf = (dbId: string | bigint) => BigInt(dbId) - (BigInt(dbId) % SPAN);
function currentBase() {
  return getConfig().ropes?.idBase ?? ROPE_BASE;
}

/** The v2 deployment a database pot id belongs to. */
export function deploymentOf(dbId: string | bigint) {
  const base = baseOf(dbId);
  return getConfig().ropesAll.find((d) => d.idBase === base) ?? null;
}

export function ropesConfig() {
  const r = getConfig().ropes;
  if (!r) throw new Error("HonorCatRopes is not configured (ROPES_ADDRESS or deployments/<chain>.ropes.json)");
  return r;
}

/** The contract, its EIP-712 domain name and its MedianResolver for a database pot id. */
export function contractOf(dbId: string | bigint): { address: Address; v2: boolean; name: "HonorCatPots" | "HonorCatRopes" | "HonorCatGroups"; median: Address | null; chainPotId: bigint; group?: boolean } {
  if (isGroupDbId(dbId)) {
    const g = getConfig().groups;
    if (!g) throw new Error(`no HonorCatGroups deployment for ${dbId}`);
    return { address: g.address, v2: true, name: "HonorCatGroups", median: g.median, chainPotId: chainPotId(dbId), group: true };
  }
  if (isRopeDbId(dbId)) {
    const r = deploymentOf(dbId);
    if (!r) throw new Error(`no HonorCat v2 deployment for pot ${dbId}`);
    return { address: r.address, v2: true, name: "HonorCatRopes", median: r.median, chainPotId: chainPotId(dbId) };
  }
  const p = getConfig().pots;
  if (!p) throw new Error("HonorCatPots is not configured");
  return { address: p.address, v2: false, name: "HonorCatPots", median: getConfig().median, chainPotId: BigInt(dbId) };
}

/** The domain name for a pot contract address (v2 when it is the configured HonorCatRopes). */
export function domainNameFor(address: Address): "HonorCatPots" | "HonorCatRopes" | "HonorCatGroups" {
  const g = getConfig().groups;
  if (g && getAddress(g.address) === getAddress(address)) return "HonorCatGroups";
  return getConfig().ropesAll.some((d) => getAddress(d.address) === getAddress(address)) ? "HonorCatRopes" : "HonorCatPots";
}

/** Start of expiry window `attempt` (0 = the expiry window itself), as the contract computes it. */
export function expiryWindowStart(expiry: number, window: number, attempt: number) {
  return expiry + 1 + attempt * (window + 60);
}

/** New exits, knock-outs and extra lives stop this long before a pot's end (expiry for a rope). */
export function lockoutS(window: number) {
  return Math.max(1 + window + 60, 120);
}

/**
 * Whether a sampler's own window average is at or beyond a post. Posts at 0 or 100 do not exist
 * (that side has no rope), so they never knock out.
 */
export function atPost(ppm: number, lower: number, upper: number): "lower" | "upper" | null {
  if (lower > 0 && ppm <= lower) return "lower";
  if (upper < P && ppm >= upper) return "upper";
  return null;
}

/**
 * Whether a knock-out window ending at `windowEnd` can be used: it must start after the posts last
 * moved and end before the lock-out of the expiry (the contract refuses it otherwise).
 */
export function knockWindowOk(w: { windowEnd: number; window: number; armedAt: number; expiry: number }) {
  const start = w.windowEnd - w.window;
  return start > w.armedAt && w.windowEnd + lockoutS(w.window) < w.expiry;
}

/** Plain words for a rope's leverage, as the create page and the pot page say it. */
export function leverageOf(entry: number, lower: number, upper: number) {
  return {
    yes: lower > 0 ? entry / (entry - lower) : 1,
    no: upper < P ? (P - entry) / (upper - entry) : 1,
  };
}
