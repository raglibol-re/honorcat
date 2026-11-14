/**
 * @verdict/sdk: a thin, dependency-light client for a Verdict deployment.
 *
 *   const verdict = new Verdict({ baseUrl: "https://verdict-phi-livid.vercel.app", apiKey: process.env.VERDICT_KEY });
 *   const { conditionId } = await verdict.registerCondition({ source: "api", key: "order-1042" });
 *   const { potId } = await verdict.createPotGasless({ signer, amount: 5_000_000n, params: { conditionId, ... } });
 *   await verdict.reportOutcome(conditionId, true);
 *   const pot = await verdict.waitForSettlement(potId);
 *
 * Only `viem` is required (peer dependency), for typed-data signing and hashing.
 */
import { keccak256, stringToBytes, type Address, type Hex, type TypedDataDefinition } from "viem";

export type Source = "api" | "manual" | "gemini" | "http";

export type Condition = { conditionId: Hex; source: string; key: string; label: string | null; owner: string | null };

export type Pot = {
  potId: number;
  conditionId: Hex;
  creator: Address;
  resolver: Address;
  refundTo: Address;
  deadline: number;
  payees: { address: Address; shareBps: number }[];
  status: "open" | "resolved" | "expired";
  outcome: boolean | null;
  total: string;
  fundingCount: number;
  settledTx: Hex | null;
};

export type Payment = {
  txHash: Hex;
  potId: number | null;
  kind: "payout" | "refund" | "payout_deferred" | "refund_deferred" | "claim";
  recipient: Address;
  amount: string;
};

export type PotDetail = {
  pot: Pot;
  events: { txHash: Hex; logIndex: number; blockNumber: number; time: number | null; name: string; args: Record<string, unknown> }[];
  payments: Payment[];
  relayCost?: { totalUsdc: string; txs: { txHash: Hex; kind: string; feeUsdc: string | null }[] };
};

export type PotParams = {
  conditionId: Hex;
  resolver: Address;
  payees: Address[];
  sharesBps: number[];
  refundTo: Address;
  /** Unix seconds. */
  deadline: bigint | number;
};

/** Anything that can sign EIP-712 typed data: a viem LocalAccount or a WalletClient with an account. */
export type TypedDataSigner = {
  address?: Address;
  account?: { address: Address };
  signTypedData: (args: TypedDataDefinition & { account?: unknown }) => Promise<Hex>;
};

export class VerdictError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** conditionId = keccak256("<source>:<key>"), the same derivation the relay uses. */
export function conditionIdFor(source: string, key: string): Hex {
  return keccak256(stringToBytes(`${source}:${key}`));
}

type Prepared = {
  salt: Hex;
  nonce: Hex;
  validAfter: string;
  validBefore: string;
  typedData: {
    domain: { name: string; version: string; chainId: number | string; verifyingContract: Address };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
  };
};

export class Verdict {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { baseUrl: string; apiKey?: string; fetch?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new VerdictError((json as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
    return json as T;
  }

  // ------------------------------------------------------------ integration API (API key)

  me() {
    return this.request<{ integration: { id: string; name: string; webhookUrl: string | null }; chainId: number; vault: Address; resolver: Address }>(
      "/api/v1/me",
    );
  }

  registerCondition(input: { source: Source; key: string; label?: string }) {
    return this.request<Condition>(this.apiKey ? "/api/v1/conditions" : "/api/conditions", input);
  }

  /** Final and idempotent; changing a reported outcome throws (409). */
  reportOutcome(conditionId: Hex, outcome: boolean) {
    return this.request<{ conditionId: Hex; outcome: boolean; changed: boolean }>("/api/v1/outcomes", { conditionId, outcome });
  }

  listPots(filter: { conditionId?: Hex; status?: Pot["status"] } = {}) {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
    const base = this.apiKey ? "/api/v1/pots" : "/api/pots";
    return this.request<{ pots: Pot[] }>(`${base}${q ? `?${q}` : ""}`).then((r) => r.pots);
  }

  getPot(potId: number | bigint | string) {
    return this.request<PotDetail>(`${this.apiKey ? "/api/v1/pots" : "/api/pots"}/${potId}`);
  }

  deliveries() {
    return this.request<{ deliveries: { event_id: string; event_type: string; attempts: number; delivered_at: string | null; last_error: string | null }[] }>(
      "/api/v1/deliveries",
    ).then((r) => r.deliveries);
  }

  testWebhook() {
    return this.request<{ queued: string }>("/api/v1/webhooks/test", {});
  }

  status() {
    return this.request<Record<string, unknown>>("/api/status");
  }

  /** Polls until the pot is resolved or expired (every read also advances the relay). */
  async waitForSettlement(potId: number | bigint | string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<PotDetail> {
    const until = Date.now() + (opts.timeoutMs ?? 120_000);
    for (;;) {
      const d = await this.getPot(potId).catch((e: unknown) => {
        if (e instanceof VerdictError && e.status === 404) return null;
        throw e;
      });
      if (d && d.pot.status !== "open") return d;
      if (Date.now() > until) throw new Error(`pot ${potId} not settled in time`);
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2000));
    }
  }

  // ------------------------------------------------------------ gasless funding (EIP-3009)

  private async signPrepared(signer: TypedDataSigner, from: Address, p: Prepared) {
    const m = p.typedData.message;
    const signature = await signer.signTypedData({
      ...(signer.account ? { account: signer.account } : {}),
      domain: { ...p.typedData.domain, chainId: Number(p.typedData.domain.chainId) },
      types: p.typedData.types,
      primaryType: p.typedData.primaryType,
      message: { ...m, value: BigInt(m.value), validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore) },
    } as unknown as TypedDataDefinition);
    return { from, validAfter: p.validAfter, validBefore: p.validBefore, salt: p.salt, signature };
  }

  private static addressOf(signer: TypedDataSigner): Address {
    const a = signer.address ?? signer.account?.address;
    if (!a) throw new Error("signer has no address");
    return a;
  }

  /**
   * Creates and funds a pot with one signature from `signer`; the relay submits and pays gas.
   * `params.resolver` defaults to the relay's resolver.
   */
  async createPotGasless(input: { signer: TypedDataSigner; amount: bigint; params: Omit<PotParams, "resolver"> & { resolver?: Address } }) {
    const from = Verdict.addressOf(input.signer);
    const resolver = input.params.resolver ?? (await this.request<{ resolver: Address }>("/api/health")).resolver;
    const params = { ...input.params, resolver, deadline: BigInt(input.params.deadline) };
    const prepared = await this.request<Prepared>("/api/gasless/prepare", { kind: "create", params, from, amount: input.amount });
    const authorization = await this.signPrepared(input.signer, from, prepared);
    return this.request<{ tx: Hex; potId: string | null }>("/api/gasless/create", { params, amount: input.amount, authorization });
  }

  /** Tops up an open pot with one signature. */
  async fundGasless(input: { signer: TypedDataSigner; potId: number | bigint | string; amount: bigint }) {
    const from = Verdict.addressOf(input.signer);
    const prepared = await this.request<Prepared>("/api/gasless/prepare", { kind: "fund", potId: String(input.potId), from, amount: input.amount });
    const authorization = await this.signPrepared(input.signer, from, prepared);
    return this.request<{ tx: Hex; potId: string }>("/api/gasless/fund", { potId: String(input.potId), amount: input.amount, authorization });
  }
}

// ------------------------------------------------------------ webhooks

export type WebhookEvent = {
  id: string;
  type:
    | "pot.created"
    | "pot.funded"
    | "pot.resolved"
    | "pot.expired"
    | "payment.payout"
    | "payment.refund"
    | "payment.deferred"
    | "ping";
  createdAt: string;
  chainId: number;
  vault: Address;
  potId: string | null;
  txHash: Hex | null;
  blockNumber: string | null;
  blockTime: number | null;
  data: Record<string, unknown>;
};

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Verifies `Verdict-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>` with
 * WebCrypto (Node 18+, Deno, Bun, edge runtimes). Pass the raw request body, not re-serialised JSON.
 */
export async function verifyWebhook(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  opts: { toleranceSec?: number; now?: number } = {},
): Promise<boolean> {
  const parts = Object.fromEntries((header ?? "").split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(now - t) > (opts.toleranceSec ?? 300)) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

/** Verifies and parses a webhook; throws if the signature is invalid. */
export async function parseWebhook(secret: string, header: string | null | undefined, rawBody: string): Promise<WebhookEvent> {
  if (!(await verifyWebhook(secret, header, rawBody))) throw new Error("invalid Verdict webhook signature");
  return JSON.parse(rawBody) as WebhookEvent;
}
