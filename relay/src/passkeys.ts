import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { ARC_USDC } from "./arc";
import { publicClient } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { GaslessError, logRequest } from "./gasless";
import { memoCall } from "./memo";
import { sendRelayCalls } from "./txs";

/**
 * Passkey accounts (PasskeyAccount + PasskeyAccountFactory on Arc).
 *
 * The account address is deterministic from (P-256 public key, rpIdHash), so a customer can be
 * enrolled and refunded before their account is deployed. The relay verifies WebAuthn assertions
 * off-chain with the same rules as the contract (OpenZeppelin WebAuthn + rpIdHash), and for
 * withdrawals deploys the account if needed and calls `execute` in one Multicall3From batch.
 */

export const passkeyFactoryAbi = parseAbi([
  "function accountAddress(bytes32 qx, bytes32 qy, bytes32 rpIdHash) view returns (address)",
  "function createAccount(bytes32 qx, bytes32 qy, bytes32 rpIdHash) returns (address)",
]);
export const passkeyAccountAbi = parseAbi([
  "struct WebAuthnAuth { bytes32 r; bytes32 s; uint256 challengeIndex; uint256 typeIndex; bytes authenticatorData; string clientDataJSON; }",
  "function execute(address target, uint256 value, bytes data, uint64 deadline, WebAuthnAuth auth) returns (bytes)",
  "function nonce() view returns (uint256)",
  "function executeDigest(address target, uint256 value, bytes data, uint64 deadline) view returns (bytes32)",
]);

const EXECUTE_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "PasskeyExecute(uint256 chainId,address account,uint256 nonce,address target,uint256 value,bytes32 dataHash,uint64 deadline)",
  ),
);
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export type WebAuthnAssertion = {
  authenticatorData: Hex;
  clientDataJSON: string;
  challengeIndex: number;
  typeIndex: number;
  r: Hex;
  s: Hex;
};

export const sha256Hex = (data: Uint8Array | string): Hex =>
  `0x${createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)).digest("hex")}`;

export const rpIdHashOf = (rpId: string) => sha256Hex(rpId);

function factory(): Address {
  const f = getConfig().passkeys?.factory;
  if (!f) throw new GaslessError("passkey accounts are not configured on this deployment", 503);
  return f;
}

export async function accountFor(qx: Hex, qy: Hex, rpIdHash: Hex): Promise<Address> {
  return publicClient().readContract({ address: factory(), abi: passkeyFactoryAbi, functionName: "accountAddress", args: [qx, qy, rpIdHash] });
}

/** Challenge for PasskeyAccount.execute, computed exactly like the contract (nonce read from chain, 0 if undeployed). */
export function executeDigest(chainId: number, account: Address, nonce: bigint, target: Address, value: bigint, data: Hex, deadline: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint64" }],
      [EXECUTE_TYPEHASH, BigInt(chainId), account, nonce, target, value, keccak256(data), deadline],
    ),
  );
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/**
 * Off-chain mirror of PasskeyAccount._verify: rpIdHash, UP+UV flags, BE/BS consistency, type
 * "webauthn.get", base64url challenge at challengeIndex, low-s P-256 signature over
 * sha256(authenticatorData || sha256(clientDataJSON)).
 */
export function verifyAssertion(challenge: Hex, a: WebAuthnAssertion, qx: Hex, qy: Hex, rpIdHash: Hex): boolean {
  const auth = Buffer.from(a.authenticatorData.slice(2), "hex");
  if (auth.length < 37) return false;
  if (`0x${auth.subarray(0, 32).toString("hex")}` !== rpIdHash.toLowerCase()) return false;
  const flags = auth[32]!;
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) return false; // UP, UV
  if ((flags & 0x10) !== 0 && (flags & 0x08) === 0) return false; // BS requires BE
  const cd = a.clientDataJSON;
  if (cd.slice(a.typeIndex, a.typeIndex + 21) !== '"type":"webauthn.get"') return false;
  const expected = `"challenge":"${b64url(Buffer.from(challenge.slice(2), "hex"))}"`;
  if (cd.slice(a.challengeIndex, a.challengeIndex + expected.length) !== expected) return false;
  const s = BigInt(a.s);
  const r = BigInt(a.r);
  if (r === 0n || r >= P256_N || s === 0n || s > P256_N / 2n) return false;
  const key = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64url(Buffer.from(qx.slice(2), "hex")), y: b64url(Buffer.from(qy.slice(2), "hex")) },
    format: "jwk",
  });
  const signed = Buffer.concat([auth, Buffer.from(sha256Hex(cd).slice(2), "hex")]);
  const sig = Buffer.concat([Buffer.from(a.r.slice(2).padStart(64, "0"), "hex"), Buffer.from(a.s.slice(2).padStart(64, "0"), "hex")]);
  return cryptoVerify("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, sig);
}

// ------------------------------------------------------------------ registry

export type PasskeyRecord = { credentialId: string; qx: Hex; qy: Hex; rpId: string; rpIdHash: Hex; account: Address };

export async function registerPasskey(db: Db, input: { credentialId: string; qx: Hex; qy: Hex; rpId: string }): Promise<PasskeyRecord> {
  if (!/^[A-Za-z0-9_-]{16,1024}$/.test(input.credentialId)) throw new GaslessError("invalid credential id");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.qx) || !/^0x[0-9a-fA-F]{64}$/.test(input.qy)) throw new GaslessError("invalid public key");
  // Rejects points not on the curve.
  try {
    createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64url(Buffer.from(input.qx.slice(2), "hex")), y: b64url(Buffer.from(input.qy.slice(2), "hex")) },
      format: "jwk",
    });
  } catch {
    throw new GaslessError("public key is not a valid P-256 point");
  }
  const rpIdHash = rpIdHashOf(input.rpId);
  const account = await accountFor(input.qx, input.qy, rpIdHash);
  await db.query(
    `INSERT INTO passkeys (credential_id, qx, qy, rp_id, rp_id_hash, account) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (credential_id) DO NOTHING`,
    [input.credentialId, input.qx.toLowerCase(), input.qy.toLowerCase(), input.rpId, rpIdHash, account.toLowerCase()],
  );
  const rec = await getPasskey(db, input.credentialId);
  if (!rec) throw new GaslessError("could not register passkey", 500);
  return rec;
}

export async function getPasskey(db: Db, credentialId: string): Promise<PasskeyRecord | null> {
  const r = await db.query<{ credential_id: string; qx: Hex; qy: Hex; rp_id: string; rp_id_hash: Hex; account: Address }>(
    "SELECT credential_id, qx, qy, rp_id, rp_id_hash, account FROM passkeys WHERE credential_id = $1",
    [credentialId],
  );
  const x = r[0];
  return x ? { credentialId: x.credential_id, qx: x.qx, qy: x.qy, rpId: x.rp_id, rpIdHash: x.rp_id_hash, account: getAddress(x.account) } : null;
}

async function passkeyByAccount(db: Db, account: Address) {
  const r = await db.query<{ credential_id: string }>("SELECT credential_id FROM passkeys WHERE account = $1 LIMIT 1", [account.toLowerCase()]);
  return r[0] ? getPasskey(db, r[0].credential_id) : null;
}

/** keccak256 of the join message: the challenge a passkey signs to join a guarantee. */
export const joinChallenge = (message: string) => keccak256(new TextEncoder().encode(message));

export async function verifyPasskeyJoin(db: Db, account: Address, message: string, assertion: WebAuthnAssertion) {
  const pk = await passkeyByAccount(db, account);
  if (!pk) throw new GaslessError("unknown passkey account", 404);
  if (!verifyAssertion(joinChallenge(message), assertion, pk.qx, pk.qy, pk.rpIdHash)) throw new GaslessError("passkey signature is not valid", 401);
}

// ------------------------------------------------------------------ withdraw

async function nonceOf(account: Address): Promise<bigint> {
  const code = await publicClient().getCode({ address: account });
  if (!code || code === "0x") return 0n;
  return publicClient().readContract({ address: account, abi: passkeyAccountAbi, functionName: "nonce" });
}

export async function preparePasskeyWithdraw(db: Db, account: Address, to: Address, value: bigint) {
  const pk = await passkeyByAccount(db, account);
  if (!pk) throw new GaslessError("unknown passkey account", 404);
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(to), value] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const nonce = await nonceOf(account);
  const challenge = executeDigest(getConfig().chainId, account, nonce, ARC_USDC, 0n, data, deadline);
  return { account, target: ARC_USDC, value: "0", data, deadline: deadline.toString(), nonce: nonce.toString(), challenge };
}

/**
 * Deploys the account if needed and runs the passkey-authorised USDC transfer, in one
 * Multicall3From batch paid by the relay. Only registered passkeys of enrolled customers.
 */
export async function submitPasskeyWithdraw(
  db: Db,
  input: { account: Address; to: Address; value: bigint; deadline: bigint; assertion: WebAuthnAssertion; guaranteeId?: string },
) {
  const pk = await passkeyByAccount(db, input.account);
  if (!pk) throw new GaslessError("unknown passkey account", 404);
  if (input.value <= 0n) throw new GaslessError("amount must be positive");
  const enrolled = await db.query(
    `SELECT 1 FROM chain_events WHERE contract = 'book' AND event_name = 'Enrolled' AND args->>'account' = $1 LIMIT 1`,
    [input.account.toLowerCase()],
  );
  if (!enrolled.length && process.env.PASSKEY_WITHDRAW_ANY !== "true") {
    throw new GaslessError("only enrolled customers can withdraw through the relay", 403);
  }
  const recent = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM gasless_requests WHERE funder = $1 AND kind = 'withdraw' AND created_at > now() - interval '1 day'`,
    [input.account.toLowerCase()],
  );
  if (Number(recent[0]?.n ?? 0) >= 5) throw new GaslessError("withdrawal limit reached for today", 429);

  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(input.to), input.value] });
  const nonce = await nonceOf(input.account);
  const challenge = executeDigest(getConfig().chainId, input.account, nonce, ARC_USDC, 0n, data, input.deadline);
  if (!verifyAssertion(challenge, input.assertion, pk.qx, pk.qy, pk.rpIdHash)) throw new GaslessError("passkey signature is not valid", 401);

  const exec = encodeFunctionData({
    abi: passkeyAccountAbi,
    functionName: "execute",
    args: [
      ARC_USDC,
      0n,
      data,
      input.deadline,
      {
        r: input.assertion.r,
        s: input.assertion.s,
        challengeIndex: BigInt(input.assertion.challengeIndex),
        typeIndex: BigInt(input.assertion.typeIndex),
        authenticatorData: input.assertion.authenticatorData,
        clientDataJSON: input.assertion.clientDataJSON,
      },
    ],
  });
  const ref = input.guaranteeId ? `guarantee-${input.guaranteeId}` : "withdraw";
  const res = await sendRelayCalls(
    db,
    "withdraw",
    [
      {
        target: factory(),
        callData: encodeFunctionData({ abi: passkeyFactoryAbi, functionName: "createAccount", args: [pk.qx, pk.qy, pk.rpIdHash] }),
        label: "deploy account",
      },
      { ...memoCall(input.account, exec, ref, { v: 1, t: "withdraw", ref, why: "Customer withdrew with a passkey; HonorCat paid the fee" }), label: "execute" },
    ],
    { atomic: true, memoTxsOf: true },
  );
  await logRequest(db, input.account, null, "withdraw", input.value, res.tx);
  if (!res.ok) throw new GaslessError(`withdrawal failed: ${res.error}`, 502);
  return { tx: res.tx, account: input.account };
}

export { toHex };
