import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { ARC_USDC } from "./arc";
import { publicClient, relaySender } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { logRequest } from "./gasless";
import { memoCall } from "./memo";
import { sendRelayCalls } from "./txs";

/**
 * Test money without faucets, for users. HonorCat's pool (the relay wallet) funds every account:
 * a welcome amount on first sign-in, and a top-up whenever a deposit needs more than the account
 * holds. Testnet only, with per-account and daily limits and a floor the pool never goes below.
 * The pool refills itself from Circle's faucet API every 3 hours when CIRCLE_API_KEY is set.
 */
export const WELCOME = 2_000_000n; // $2 on first sign-in
const GAS_BUFFER = 100_000n; // $0.10 so wallets can pay Arc's fees (in USDC)
const PER_ACCOUNT_DAY = 10_000_000n; // at most $10 a day per account
const POOL_DAY = 80_000_000n; // at most $80 a day in total
const POOL_FLOOR = 3_000_000n; // keep $3 for the relay's own gas

type Result = { sent: boolean; amount?: string; tx?: string; reason?: string };

async function poolBalance() {
  return publicClient().readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [relaySender()] });
}

async function given(db: Db, account: string | null, since: string) {
  const r = await db.query<{ s: string | null }>(
    `SELECT sum(amount::numeric)::text AS s FROM gasless_requests WHERE kind IN ('drip','topup') AND created_at > now() - $2::interval ${account ? "AND funder = $1" : "AND $1::text IS NULL"}`,
    [account, since],
  );
  return BigInt(r[0]?.s?.split(".")[0] ?? "0");
}

async function send(db: Db, account: Address, amount: bigint, kind: "drip" | "topup", why: string): Promise<Result> {
  if (getConfig().chainId !== 5042002) return { sent: false, reason: "testnet only" };
  const pool = await poolBalance();
  if (pool < POOL_FLOOR + amount) return { sent: false, reason: "the test-money pool is being refilled; try again in a few minutes" };
  if ((await given(db, null, "1 day")) + amount > POOL_DAY) return { sent: false, reason: "today's test money is used up; try again tomorrow" };
  await logRequest(db, account, null, kind, amount); // claim first, so parallel calls cannot both send
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(account), amount] });
  const res = await sendRelayCalls(db, "pot_exec", [{ ...memoCall(ARC_USDC, data, kind, { v: 1, t: "pot", ref: kind, why }), label: kind }]);
  if (!res.ok) return { sent: false, reason: res.error.slice(0, 200) };
  await publicClient().waitForTransactionReceipt({ hash: res.tx, timeout: 30_000 }).catch(() => null);
  return { sent: true, amount: amount.toString(), tx: res.tx };
}

/** The welcome amount, once per account, on first sign-in (passkey or wallet). */
export async function welcome(db: Db, account: Address): Promise<Result> {
  const a = account.toLowerCase();
  const done = await db.query("SELECT 1 FROM gasless_requests WHERE funder = $1 AND kind = 'drip' LIMIT 1", [a]);
  if (done.length) return { sent: false, reason: "already welcomed" };
  return send(db, account, WELCOME, "drip", "welcome test money for a new account");
}

/**
 * Makes sure an account can pay a deposit of `need` (plus a little for fees): sends the shortfall
 * from the pool, within the per-account daily limit. Nothing happens when the account has enough.
 */
export async function topUp(db: Db, account: Address, need: bigint): Promise<Result> {
  if (need <= 0n || need > 25_000_000n) return { sent: false, reason: "nothing to top up" };
  const bal = await publicClient().readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  const want = need + GAS_BUFFER;
  if (bal >= want) return { sent: false, reason: "enough already" };
  const amount = want - bal;
  if ((await given(db, account.toLowerCase(), "1 day")) + amount > PER_ACCOUNT_DAY) return { sent: false, reason: "this account reached today's test-money limit ($10)" };
  return send(db, account, amount, "topup", "test money to cover a deposit");
}

/* ------------------------------------------------------------------ refilling the pool */

const REFILL_EVERY_MS = 3 * 3600_000;

/**
 * Asks Circle's faucet API (developers.circle.com, `POST /v1/faucet/drips`) to send testnet USDC
 * to the pool on Arc. Needs CIRCLE_API_KEY. At most every 3 hours (Circle rate-limits drips).
 */
export async function refillPool(db: Db, opts: { force?: boolean } = {}) {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) return { ran: false, reason: "CIRCLE_API_KEY is not set" };
  const last = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'pool_refill_at'");
  if (!opts.force && last[0] && Date.now() - Number(last[0].value) < REFILL_EVERY_MS) return { ran: false, reason: "refilled less than 3 hours ago" };
  await db.query("INSERT INTO relay_state (key, value) VALUES ('pool_refill_at', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(Date.now())]);
  const before = await poolBalance();
  const r = await fetch("https://api.circle.com/v1/faucet/drips", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ address: relaySender(), blockchain: "ARC-TESTNET", usdc: true, native: false, eurc: false }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => (e as Error).message }) as unknown as Response);
  const body = await r.text().catch(() => "");
  await db.query("INSERT INTO relay_state (key, value) VALUES ('pool_refill_last', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [
    JSON.stringify({ at: new Date().toISOString(), status: r.status, ok: r.ok, body: body.slice(0, 300), poolBefore: before.toString() }),
  ]);
  return { ran: true, ok: r.ok, status: r.status, body: body.slice(0, 300), poolBefore: before.toString() };
}

export async function poolStatus(db: Db) {
  const last = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'pool_refill_last'");
  return {
    pool: (await poolBalance()).toString(),
    givenToday: (await given(db, null, "1 day")).toString(),
    dailyLimit: POOL_DAY.toString(),
    refill: process.env.CIRCLE_API_KEY ? "Circle faucet API every 3 hours" : "manual (CIRCLE_API_KEY not set)",
    lastRefill: last[0] ? JSON.parse(last[0].value) : null,
  };
}
