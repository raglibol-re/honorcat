import { readFileSync } from "node:fs";
import { z } from "zod";
import { getAddress, isAddress, type Address, type Hex } from "viem";

const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex private key");

const schema = z.object({
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.io"),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  VAULT_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_VAULT_ADDRESS: z.string().optional(),
  VAULT_DEPLOY_BLOCK: z.coerce.bigint().optional(),
  RESOLVER_PRIVATE_KEY: hexKey.optional(),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default(".data/pglite"),
  INDEXER_PRIMARY: z.enum(["rpc", "streams"]).default("rpc"),
  QUICKNODE_STREAMS_TOKEN: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  GEMINI_API_BASE: z.string().url().default("https://api.gemini.com"),
  TICK_MIN_INTERVAL_MS: z.coerce.number().default(4000),
  AUTO_EXPIRE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  DEPLOYMENTS_FILE: z.string().optional(),
  GUARANTEE_BOOK_ADDRESS: z.string().optional(),
  BATCH_GUARD_ADDRESS: z.string().optional(),
  GUARANTEES_DEPLOY_BLOCK: z.coerce.bigint().optional(),
  PASSKEY_FACTORY_ADDRESS: z.string().optional(),
  MERKLE_BOOK_ADDRESS: z.string().optional(),
  /** Smallest amount (USDC, decimal) the relay will sponsor gas for. */
  GASLESS_MIN_AMOUNT: z.string().regex(/^\d+(\.\d{1,6})?$/).default("0.10"),
  /** Sponsored submissions per funder address per hour (API-key callers are exempt). */
  GASLESS_MAX_PER_HOUR: z.coerce.number().int().min(0).default(10),
  /** Below this resolver balance (USDC) /api/status reports "low". */
  RELAY_LOW_BALANCE_USDC: z.string().regex(/^\d+(\.\d{1,6})?$/).default("1"),
  /** Tests only: allow http:// and private hosts in the HTTP result source. */
  HTTP_SOURCE_ALLOW_INSECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

/** Parses a decimal USDC string into 6-decimal base units. */
export function usdcUnits(v: string): bigint {
  const [i, f = ""] = v.split(".");
  return BigInt(i!) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

export type Config = {
  rpcUrl: string;
  chainId: number;
  vault: Address;
  deployBlock: bigint;
  resolverKey?: Hex;
  databaseUrl?: string;
  pgliteDir: string;
  indexerPrimary: "rpc" | "streams";
  streamsToken?: string;
  adminToken?: string;
  cronSecret?: string;
  geminiBase: string;
  tickMinIntervalMs: number;
  autoExpire: boolean;
  gaslessMinAmount: bigint;
  gaslessMaxPerHour: number;
  lowBalance: bigint;
  httpSourceAllowInsecure: boolean;
  /** GuaranteeBook + BatchGuard (Verdict Guarantees); null if not deployed/configured. */
  guarantees: { book: Address; guard: Address; deployBlock: bigint } | null;
  /** PasskeyAccountFactory for payee passkey accounts; null if not configured. */
  passkeys: { factory: Address } | null;
  merkle: { book: Address } | null;
};

let cached: Config | undefined;

/** Reads configuration lazily so that importing the package at build time needs no env. */
export function getConfig(): Config {
  if (cached) return cached;
  const env = schema.parse(process.env);

  let vault = env.VAULT_ADDRESS ?? env.NEXT_PUBLIC_VAULT_ADDRESS;
  let deployBlock = env.VAULT_DEPLOY_BLOCK;
  if (!vault || deployBlock === undefined) {
    const fromFile = readDeploymentFile(env.DEPLOYMENTS_FILE, env.ARC_CHAIN_ID);
    vault ??= fromFile?.vault;
    deployBlock ??= fromFile ? BigInt(fromFile.deployBlock) : undefined;
  }
  if (!vault || !isAddress(vault)) throw new Error("VAULT_ADDRESS is not set (or deployments file missing)");
  if (env.ARC_CHAIN_ID !== 5042002) throw new Error("Only Arc testnet (5042002) is supported");
  if (process.env.VERCEL && !env.DATABASE_URL) throw new Error("DATABASE_URL is required on Vercel");

  cached = {
    rpcUrl: env.ARC_RPC_URL,
    chainId: env.ARC_CHAIN_ID,
    vault: getAddress(vault),
    deployBlock: deployBlock ?? 0n,
    resolverKey: env.RESOLVER_PRIVATE_KEY as Hex | undefined,
    databaseUrl: env.DATABASE_URL,
    pgliteDir: env.PGLITE_DIR,
    indexerPrimary: env.INDEXER_PRIMARY,
    streamsToken: env.QUICKNODE_STREAMS_TOKEN,
    adminToken: env.ADMIN_TOKEN,
    cronSecret: env.CRON_SECRET,
    geminiBase: env.GEMINI_API_BASE,
    tickMinIntervalMs: env.TICK_MIN_INTERVAL_MS,
    autoExpire: env.AUTO_EXPIRE,
    gaslessMinAmount: usdcUnits(env.GASLESS_MIN_AMOUNT),
    gaslessMaxPerHour: env.GASLESS_MAX_PER_HOUR,
    lowBalance: usdcUnits(env.RELAY_LOW_BALANCE_USDC),
    httpSourceAllowInsecure: env.HTTP_SOURCE_ALLOW_INSECURE,
    guarantees: guaranteesConfig(env),
    passkeys: passkeysConfig(env),
    merkle: merkleConfig(env),
  };
  return cached;
}

function guaranteesConfig(env: z.infer<typeof schema>): Config["guarantees"] {
  let book = env.GUARANTEE_BOOK_ADDRESS;
  let guard = env.BATCH_GUARD_ADDRESS;
  let block = env.GUARANTEES_DEPLOY_BLOCK;
  if (!book || !guard || block === undefined) {
    const f = readJson<{ guaranteeBook: string; batchGuard: string; deployBlock: number }>(
      env.DEPLOYMENTS_FILE ? undefined : `deployments/${env.ARC_CHAIN_ID}.guarantees.json`,
    );
    book ??= f?.guaranteeBook;
    guard ??= f?.batchGuard;
    block ??= f ? BigInt(f.deployBlock) : undefined;
  }
  if (!book || !guard || !isAddress(book) || !isAddress(guard)) return null;
  return { book: getAddress(book), guard: getAddress(guard), deployBlock: block ?? 0n };
}

function passkeysConfig(env: z.infer<typeof schema>): Config["passkeys"] {
  const f =
    env.PASSKEY_FACTORY_ADDRESS ??
    readJson<{ passkeyAccountFactory: string }>(`deployments/${env.ARC_CHAIN_ID}.passkeys.json`)?.passkeyAccountFactory;
  return f && isAddress(f) ? { factory: getAddress(f) } : null;
}

function merkleConfig(env: z.infer<typeof schema>): Config["merkle"] {
  const b = env.MERKLE_BOOK_ADDRESS ?? readJson<{ merkleBook: string }>(`deployments/${env.ARC_CHAIN_ID}.merkle.json`)?.merkleBook;
  return b && isAddress(b) ? { book: getAddress(b) } : null;
}

function readJson<T>(relative: string | undefined): T | undefined {
  if (!relative) return undefined;
  for (const p of [relative, `../${relative}`]) {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch {
      /* next */
    }
  }
  return undefined;
}

function readDeploymentFile(path: string | undefined, chainId: number) {
  const candidates = path
    ? [path]
    : [`deployments/${chainId}.json`, `../deployments/${chainId}.json`];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as { vault: string; deployBlock: number };
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** For tests. */
export function resetConfig() {
  cached = undefined;
}
