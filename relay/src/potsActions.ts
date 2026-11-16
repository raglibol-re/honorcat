/**
 * Submitting pot actions for users, with the relay paying gas (in USDC, Arc's gas token).
 *
 * - Passkey accounts: the user signs `execute(target, data)` challenges with the passkey. The relay
 *   checks each step is a call to the pot contract (or a USDC approval for it), deploys the account
 *   if needed and runs every step in one atomic transaction. A deposit that needs more allowance
 *   adds an approval step first (one more passkey prompt; it approves at least 100 USDC so the next
 *   deposits need only one).
 * - Wallets (EOA): deposits by EIP-3009 authorization (create, join, takeover), exits by a signed
 *   request (`requestExitFor`) and handshakes by both owners' signatures. The relay only forwards:
 *   every signature is checked by the contract. It never submits a deposit that would be paid by
 *   the relay itself (`auth.v == 0`).
 */
import { decodeFunctionData, encodeFunctionData, parseEventLogs, erc20Abi, getAddress, maxUint256, type Address, type Hex } from "viem";
import { ARC_USDC } from "./arc";
import { publicClient } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { GaslessError, logRequest } from "./gasless";
import { memoCall } from "./memo";
import { executeDigest, passkeyByAccount as getPasskeyByAccount, passkeyAccountAbi, passkeyFactoryAbi, verifyAssertion, type WebAuthnAssertion } from "./passkeys";
import { potsAbi } from "./potsAbi";
import { potsAddress, syncPot } from "./pots";
import { sendRelayCalls } from "./txs";

const OWNER_CALLS = new Set(["create", "requestJoin", "cancel", "requestExit", "setLevels", "takeover", "transferFrom", "safeTransferFrom", "withdraw", "abandonJoin", "abandonExit", "expire"]);
const FORWARD_CALLS = new Set(["create", "requestJoin", "takeover", "requestExitFor", "handshake", "abandonJoin", "abandonExit", "expire", "cancel"]);
const MIN_APPROVAL = 100_000_000n;
const DAILY_LIMIT = 40;

type Step = { target: Address; data: Hex; deadline: string; nonce: string; challenge: Hex; label: string };

async function nonceOf(account: Address): Promise<bigint> {
  const code = await publicClient().getCode({ address: account });
  if (!code || code === "0x") return 0n;
  return publicClient().readContract({ address: account, abi: passkeyAccountAbi, functionName: "nonce" });
}

function decodePots(data: Hex) {
  try {
    return decodeFunctionData({ abi: potsAbi, data });
  } catch {
    throw new GaslessError("not a call to the pot contract", 400);
  }
}

async function rateLimit(db: Db, who: Address) {
  const r = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM gasless_requests WHERE funder = $1 AND kind LIKE 'pot%' AND created_at > now() - interval '1 day'`,
    [who.toLowerCase()],
  );
  if (Number(r[0]?.n ?? 0) >= DAILY_LIMIT) throw new GaslessError("daily limit of relayed pot actions reached", 429);
}

/**
 * Steps to sign for a passkey account. `spend` is the USDC the call deposits (0 for none); the
 * relay adds an approval step if the allowance is short.
 */
export async function preparePasskeyPotCall(db: Db, account: Address, data: Hex, spend: bigint) {
  const pk = await getPasskeyByAccount(db, account);
  if (!pk) throw new GaslessError("unknown passkey account", 404);
  const call = decodePots(data);
  if (!OWNER_CALLS.has(call.functionName)) throw new GaslessError(`${call.functionName} is not relayed`, 400);
  const pots = potsAddress();
  const chainId = getConfig().chainId;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  let nonce = await nonceOf(account);
  const steps: Step[] = [];
  if (spend > 0n) {
    const allowance = await publicClient().readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "allowance", args: [account, pots] });
    if (allowance < spend) {
      const amount = spend > MIN_APPROVAL ? spend : MIN_APPROVAL;
      const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [pots, amount] });
      steps.push({ target: ARC_USDC, data: approve, deadline: deadline.toString(), nonce: nonce.toString(), challenge: executeDigest(chainId, account, nonce, ARC_USDC, 0n, approve, deadline), label: `allow the pot contract to take up to ${Number(amount) / 1e6} USDC` });
      nonce += 1n;
    }
  }
  steps.push({ target: pots, data, deadline: deadline.toString(), nonce: nonce.toString(), challenge: executeDigest(chainId, account, nonce, pots, 0n, data, deadline), label: call.functionName });
  return { account, steps };
}

export async function submitPasskeyPotCall(db: Db, input: { account: Address; steps: { target: Address; data: Hex; deadline: string; nonce: string; assertion: WebAuthnAssertion }[]; ref?: string }) {
  const pk = await getPasskeyByAccount(db, input.account);
  if (!pk) throw new GaslessError("unknown passkey account", 404);
  if (!input.steps.length || input.steps.length > 3) throw new GaslessError("one to three steps", 400);
  await rateLimit(db, input.account);
  const pots = potsAddress();
  const chainId = getConfig().chainId;
  let nonce = await nonceOf(input.account);
  const calls = [];
  let potId: string | null = null;
  let what = "";
  for (const s of input.steps) {
    const target = getAddress(s.target);
    if (target === ARC_USDC) {
      const c = decodeFunctionData({ abi: erc20Abi, data: s.data });
      if (c.functionName !== "approve" || getAddress(c.args[0] as Address) !== pots) throw new GaslessError("only an approval for the pot contract", 400);
    } else if (target === pots) {
      const c = decodePots(s.data);
      if (!OWNER_CALLS.has(c.functionName)) throw new GaslessError(`${c.functionName} is not relayed`, 400);
      what = c.functionName;
      const first = (c.args as readonly unknown[] | undefined)?.[0];
      if (typeof first === "bigint") potId = first.toString();
    } else throw new GaslessError("target is not the pot contract", 400);
    if (BigInt(s.nonce) !== nonce) throw new GaslessError("stale account nonce; prepare again", 409);
    const challenge = executeDigest(chainId, input.account, nonce, target, 0n, s.data, BigInt(s.deadline));
    if (!verifyAssertion(challenge, s.assertion, pk.qx, pk.qy, pk.rpIdHash)) throw new GaslessError("passkey signature is not valid", 401);
    const exec = encodeFunctionData({
      abi: passkeyAccountAbi,
      functionName: "execute",
      args: [
        target,
        0n,
        s.data,
        BigInt(s.deadline),
        { r: s.assertion.r, s: s.assertion.s, challengeIndex: BigInt(s.assertion.challengeIndex), typeIndex: BigInt(s.assertion.typeIndex), authenticatorData: s.assertion.authenticatorData, clientDataJSON: s.assertion.clientDataJSON },
      ],
    });
    const ref = input.ref ?? (potId ? `pot-${potId}` : "pot");
    calls.push({ ...memoCall(input.account, exec, ref, { v: 1, t: "pot", ref, why: `${target === ARC_USDC ? "approval" : what} by passkey; HonorCat paid the fee` }), label: target === ARC_USDC ? "approve" : what });
    nonce += 1n;
  }
  const factory = getConfig().passkeys?.factory;
  if (!factory) throw new GaslessError("passkey accounts are not configured", 503);
  const res = await sendRelayCalls(
    db,
    "pot_exec",
    [{ target: factory, callData: encodeFunctionData({ abi: passkeyFactoryAbi, functionName: "createAccount", args: [pk.qx, pk.qy, pk.rpIdHash] }), label: "deploy account" }, ...calls],
    { atomic: true, memoTxsOf: true },
  );
  await logRequest(db, input.account, null, `pot:${what}`, 0n, res.ok ? res.tx : undefined);
  if (!res.ok) throw new GaslessError(`${what} failed: ${res.error}`, 502);
  await afterPotTx(db, res.tx, potId);
  return { tx: res.tx, potId };
}

/** Forwards a wallet-signed pot call (EIP-3009 deposit, signed exit request, handshake). */
export async function forwardPotCall(db: Db, data: Hex) {
  const call = decodePots(data);
  if (!FORWARD_CALLS.has(call.functionName)) throw new GaslessError(`${call.functionName} is not forwarded`, 400);
  const args = call.args as readonly unknown[];
  let payer: Address | null = null;
  if (call.functionName === "create" || call.functionName === "requestJoin" || call.functionName === "takeover") {
    const auth = args[args.length - 1] as { from: Address; v: number };
    if (!auth.v) throw new GaslessError("a deposit through the relay needs an EIP-3009 authorization", 400);
    payer = getAddress(auth.from);
    await rateLimit(db, payer);
  }
  const pots = potsAddress();
  const potId = typeof args[0] === "bigint" ? (args[0] as bigint).toString() : null;
  const ref = potId ? `pot-${potId}` : "pot";
  const res = await sendRelayCalls(db, "pot_forward", [{ ...memoCall(pots, data, ref, { v: 1, t: "pot", ref, why: `${call.functionName}, signed by the user; HonorCat paid the fee` }), label: call.functionName }]);
  if (payer) await logRequest(db, payer, null, `pot:${call.functionName}`, 0n, res.ok ? res.tx : undefined);
  if (!res.ok) throw new GaslessError(`${call.functionName} failed: ${res.error}`, 502);
  await afterPotTx(db, res.tx, potId);
  return { tx: res.tx, potId };
}

/** After a pot transaction: read the affected pot (a new pot's id from its PotCreated log). */
export async function afterPotTx(db: Db, tx: Hex, potId: string | null) {
  const c = publicClient();
  const pots = potsAddress();
  const receipt = await c.waitForTransactionReceipt({ hash: tx, timeout: 30_000 }).catch(() => null);
  const ids = new Set<string>(potId ? [potId] : []);
  const logs = parseEventLogs({ abi: potsAbi, logs: (receipt?.logs ?? []).filter((l) => getAddress(l.address) === pots) });
  for (const l of logs) {
    const id = (l.args as { potId?: bigint }).potId;
    if (typeof id === "bigint") ids.add(id.toString());
  }
  for (const id of ids) await syncPot(db, BigInt(id), tx).catch((e) => console.error("[pots] sync", id, e));
  return [...ids];
}

export { maxUint256 };
