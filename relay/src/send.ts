/**
 * Sending test USDC from a passkey account to another player (found by display name) or to any
 * address (the player's own wallet). The player signs `transfer(to, amount)` with the passkey; the
 * relay checks the signature, deploys the account if needed and pays the network fee. Names are not
 * unique, so the page shows each match's cat and short address and the player picks one.
 */
import { erc20Abi, getAddress, isAddress, type Address } from "viem";
import { ARC_USDC } from "./arc";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { GaslessError, logRequest } from "./gasless";
import { passkeyByAccount, preparePasskeyWithdraw, runPasskeyTransfer, type WebAuthnAssertion } from "./passkeys";
import { practiceAddress } from "./practice";

const SENDS_PER_DAY = 20;

export type Player = { account: Address; name: string | null; fur: string | null };

/** Players whose name contains `q` (exact and prefix matches first), or the one account `q` names. */
export async function findPlayers(db: Db, q: string): Promise<Player[]> {
  const s = q.normalize("NFKC").trim();
  if (isAddress(s)) {
    const r = await db.query<{ name: string; fur: string | null }>("SELECT name, fur FROM display_names WHERE account = $1", [s.toLowerCase()]);
    return [{ account: getAddress(s), name: r[0]?.name ?? null, fur: r[0]?.fur ?? null }];
  }
  if (s.length < 2 || s.length > 20) return [];
  let practice = "";
  try {
    practice = practiceAddress().toLowerCase();
  } catch {
    /* no relay key */
  }
  const like = `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.query<{ account: string; name: string; fur: string | null }>(
    `SELECT account, name, fur FROM display_names
     WHERE name ILIKE $1 AND account <> $2
     ORDER BY (lower(name) = lower($3)) DESC, (name ILIKE $4) DESC, updated_at DESC LIMIT 8`,
    [like, practice, s, `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
  );
  return rows.map((r) => ({ account: getAddress(r.account), name: r.name, fur: r.fur }));
}

/** The challenge the passkey signs for sending `value` to `to`. */
export async function prepareSend(db: Db, account: Address, to: Address, value: bigint) {
  if (getAddress(to) === getAddress(account)) throw new GaslessError("that is your own account", 400);
  if (value <= 0n) throw new GaslessError("amount must be positive", 400);
  return preparePasskeyWithdraw(db, account, to, value);
}

/** Runs a passkey-signed send; HonorCat pays the fee. `potId` when it is a share from a finished pot. */
export async function submitSend(
  db: Db,
  input: { account: Address; to: Address; value: bigint; deadline: bigint; assertion: WebAuthnAssertion; potId?: string },
) {
  const pk = await passkeyByAccount(db, input.account);
  if (!pk) throw new GaslessError("unknown passkey account", 404);
  const to = getAddress(input.to);
  if (to === getAddress(input.account)) throw new GaslessError("that is your own account", 400);
  if (input.value <= 0n) throw new GaslessError("amount must be positive", 400);
  const bal = await publicClient().readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [input.account] });
  if (bal < input.value) throw new GaslessError("more than the account holds", 400);
  const recent = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM gasless_requests WHERE funder = $1 AND kind = 'send' AND created_at > now() - interval '1 day'",
    [input.account.toLowerCase()],
  );
  if (Number(recent[0]?.n ?? 0) >= SENDS_PER_DAY) throw new GaslessError("daily limit of sends reached", 429);
  const named = await db.query<{ name: string }>("SELECT name FROM display_names WHERE account = $1", [to.toLowerCase()]);
  const toName = named[0]?.name ?? `${to.slice(0, 6)}…${to.slice(-4)}`;
  const ref = input.potId ? `pot-${input.potId}` : "send";
  const why = `${input.potId ? `share of pot ${input.potId}` : "test USDC"} sent to ${toName} with a passkey; HonorCat paid the fee`.slice(0, 160);
  const res = await runPasskeyTransfer(db, pk, { ...input, to }, "pot_exec", { v: 1, t: "send", ref, why, ...(input.potId ? { pot: input.potId } : {}) });
  await logRequest(db, input.account, null, "send", input.value, res.ok ? res.tx : undefined);
  if (!res.ok) throw new GaslessError(`send failed: ${res.error}`, 502);
  return { tx: res.tx, to, toName: named[0]?.name ?? null };
}
