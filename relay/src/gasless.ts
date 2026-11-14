import {
  concat,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  keccak256,
  pad,
  parseSignature,
  recoverTypedDataAddress,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { ARC_USDC, usdcDomain } from "./arc";
import { publicClient, resolverAccount } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { sendVaultTx } from "./txs";

/**
 * Gasless funding over Arc USDC's EIP-3009 `receiveWithAuthorization`.
 *
 * The funder signs a `ReceiveWithAuthorization(from, to = vault, value, validAfter, validBefore,
 * nonce)`. The relay submits it and pays gas (in USDC, Arc's gas token). The nonce is not random:
 * the vault recomputes it from the target pot (or the full pot parameters) and a salt, so the
 * relay, or anyone who sees the signature, cannot use it for anything else. These functions
 * mirror `VerdictVault.fundNonce` / `createNonce` bit for bit.
 */

export const FUND_NONCE_TAG = keccak256(stringToBytes("VerdictVault.fund"));
export const CREATE_NONCE_TAG = keccak256(stringToBytes("VerdictVault.createAndFund"));

export type PotParams = {
  conditionId: Hex;
  resolver: Address;
  payees: Address[];
  sharesBps: number[];
  refundTo: Address;
  deadline: bigint;
};

export type SignedAuthorization = {
  from: Address;
  validAfter: bigint;
  validBefore: bigint;
  salt: Hex;
  signature: Hex;
};

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function fundNonce(chainId: number, vault: Address, potId: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [FUND_NONCE_TAG, BigInt(chainId), vault, potId, salt],
    ),
  );
}

/** Solidity `abi.encodePacked(T[])` pads every array element to 32 bytes. */
function packedArray(values: Hex[]): Hex {
  return values.length ? concat(values.map((v) => pad(v, { size: 32 }))) : "0x";
}

export function potParamsHash(p: PotParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint64" },
      ],
      [
        p.conditionId,
        p.resolver,
        keccak256(packedArray(p.payees.map((a) => a.toLowerCase() as Hex))),
        keccak256(packedArray(p.sharesBps.map((s) => toHex(s)))),
        p.refundTo,
        p.deadline,
      ],
    ),
  );
}

export function createNonce(chainId: number, vault: Address, p: PotParams, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
      [CREATE_NONCE_TAG, BigInt(chainId), vault, potParamsHash(p), salt],
    ),
  );
}

export function randomSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** The exact typed data a funder signs (e.g. with `eth_signTypedData_v4` or viem `signTypedData`). */
export function authorizationTypedData(args: {
  domain: TypedDataDomain;
  from: Address;
  vault: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}) {
  return {
    domain: args.domain,
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: args.from,
      to: args.vault,
      value: args.value,
      validAfter: args.validAfter,
      validBefore: args.validBefore,
      nonce: args.nonce,
    },
  };
}

export type GaslessPrepared = {
  kind: "fund" | "create";
  salt: Hex;
  nonce: Hex;
  validAfter: string;
  validBefore: string;
  typedData: ReturnType<typeof authorizationTypedData>;
};

/** Builds what a client needs to sign. Pure apart from reading the USDC domain once. */
export async function prepareGasless(
  input:
    | { kind: "fund"; potId: bigint; from: Address; amount: bigint; validForSeconds?: number }
    | { kind: "create"; params: PotParams; from: Address; amount: bigint; validForSeconds?: number },
): Promise<GaslessPrepared> {
  const cfg = getConfig();
  const domain = await usdcDomain(publicClient(), cfg.chainId);
  const salt = randomSalt();
  const nonce =
    input.kind === "fund"
      ? fundNonce(cfg.chainId, cfg.vault, input.potId, salt)
      : createNonce(cfg.chainId, cfg.vault, input.params, salt);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = 0n;
  const validBefore = now + BigInt(input.validForSeconds ?? 600);
  return {
    kind: input.kind,
    salt,
    nonce,
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    typedData: authorizationTypedData({
      domain,
      from: getAddress(input.from),
      vault: cfg.vault,
      value: input.amount,
      validAfter,
      validBefore,
      nonce,
    }),
  };
}

export class GaslessError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function checkPolicy(db: Db, from: Address, amount: bigint, integration: string | null) {
  const cfg = getConfig();
  if (amount < cfg.gaslessMinAmount) {
    throw new GaslessError(`amount below the sponsored minimum (${Number(cfg.gaslessMinAmount) / 1e6} USDC)`);
  }
  if (!integration && cfg.gaslessMaxPerHour >= 0) {
    const rows = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM gasless_requests WHERE funder = $1 AND created_at > now() - interval '1 hour'`,
      [from.toLowerCase()],
    );
    if (Number(rows[0]?.n ?? 0) >= cfg.gaslessMaxPerHour) throw new GaslessError("rate limit: too many sponsored transactions", 429);
  }
  const balance = await publicClient().readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [from],
  });
  if (balance < amount) throw new GaslessError("funder's USDC balance is below the amount");
}

/** Recovers the signer off-chain so an invalid authorization never costs the relay gas. */
export async function verifySigner(auth: SignedAuthorization, value: bigint, nonce: Hex) {
  const cfg = getConfig();
  const domain = await usdcDomain(publicClient(), cfg.chainId);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (auth.validBefore <= now + 5n) throw new GaslessError("authorization expired or about to expire");
  if (auth.validAfter >= now) throw new GaslessError("authorization not yet valid");
  const signer = await recoverTypedDataAddress({
    ...authorizationTypedData({
      domain,
      from: auth.from,
      vault: cfg.vault,
      value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce,
    }),
    signature: auth.signature,
  });
  if (getAddress(signer) !== getAddress(auth.from)) throw new GaslessError("signature does not match `from`");
}

export function toContractAuth(auth: SignedAuthorization) {
  const sig = parseSignature(auth.signature);
  const v = sig.v !== undefined ? Number(sig.v) : 27 + (sig.yParity ?? 0);
  return {
    from: getAddress(auth.from),
    validAfter: auth.validAfter,
    validBefore: auth.validBefore,
    salt: auth.salt,
    v,
    r: sig.r,
    s: sig.s,
  };
}

export async function logRequest(db: Db, from: Address, integration: string | null, kind: string, amount: bigint, tx?: Hex) {
  await db.query(
    "INSERT INTO gasless_requests (funder, integration, kind, amount, tx_hash) VALUES ($1, $2, $3, $4, $5)",
    [from.toLowerCase(), integration, kind, amount.toString(), tx ?? null],
  );
}

/**
 * Relays `fundWithAuthorization`. Without an API key the pot must be one this relay resolves,
 * so the relay does not sponsor gas for unrelated contracts' users.
 */
export async function submitGaslessFund(
  db: Db,
  input: { potId: bigint; amount: bigint; auth: SignedAuthorization },
  integration: string | null,
) {
  const cfg = getConfig();
  const pot = await db.query<{ resolver: string; status: string }>("SELECT resolver, status FROM pots WHERE pot_id = $1", [
    input.potId.toString(),
  ]);
  if (!pot[0]) throw new GaslessError("pot not found (not indexed yet?)", 404);
  if (pot[0].status !== "open") throw new GaslessError("pot is not open", 409);
  if (!integration && pot[0].resolver.toLowerCase() !== resolverAccount().address.toLowerCase()) {
    throw new GaslessError("this relay only sponsors pots it resolves (or use an API key)", 403);
  }
  await checkPolicy(db, input.auth.from, input.amount, integration);
  await verifySigner(input.auth, input.amount, fundNonce(cfg.chainId, cfg.vault, input.potId, input.auth.salt));

  const res = await sendVaultTx(
    db,
    "fund_gasless",
    "fundWithAuthorization",
    [input.potId, input.amount, toContractAuth(input.auth)],
    input.potId.toString(),
  );
  await logRequest(db, input.auth.from, integration, "fund", input.amount, res.tx);
  if (!res.ok) throw new GaslessError(`submission failed: ${res.error}`, 502);
  return { tx: res.tx, potId: input.potId.toString() };
}

/** Relays `createPotWithAuthorization`: create + fund in one transaction, signed by the funder only. */
export async function submitGaslessCreate(
  db: Db,
  input: { params: PotParams; amount: bigint; auth: SignedAuthorization },
  integration: string | null,
) {
  const cfg = getConfig();
  if (!integration && getAddress(input.params.resolver) !== resolverAccount().address) {
    throw new GaslessError("this relay only sponsors pots it resolves (or use an API key)", 403);
  }
  await checkPolicy(db, input.auth.from, input.amount, integration);
  await verifySigner(input.auth, input.amount, createNonce(cfg.chainId, cfg.vault, input.params, input.auth.salt));

  const p = input.params;
  const res = await sendVaultTx(db, "create_gasless", "createPotWithAuthorization", [
    {
      conditionId: p.conditionId,
      resolver: p.resolver,
      payees: p.payees,
      sharesBps: p.sharesBps,
      refundTo: p.refundTo,
      deadline: p.deadline,
    },
    input.amount,
    toContractAuth(input.auth),
  ]);
  await logRequest(db, input.auth.from, integration, "create", input.amount, res.tx);
  if (!res.ok) throw new GaslessError(`submission failed: ${res.error}`, 502);
  return { tx: res.tx, potId: res.potIds[0] ?? null };
}
