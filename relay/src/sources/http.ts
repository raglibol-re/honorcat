import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Hex } from "viem";
import { z } from "zod";
import { getCondition } from "../conditions";
import type { Db } from "../db";
import type { ResultSource } from "./types";

/**
 * No-code source: any public JSON endpoint.
 *
 * Key (JSON): {"url":"https://…","path":"data.0.status","yes":"settled_yes","no":"settled_no"}
 *   value at `path` deep-equals `yes` → true, `no` → false, anything else (or an error) → null.
 * Keys are canonicalised (sorted fields, no whitespace) before the conditionId is derived, so
 * the same spec always maps to the same id.
 *
 * Safety: https only, no redirects, 5 s timeout, 256 KB body cap, and hosts resolving to
 * private, loopback, link-local or metadata addresses are refused (SSRF). A DNS-rebinding window
 * between the check and the fetch remains; acceptable for public, read-only GETs.
 */
const specSchema = z
  .object({
    url: z.string().url(),
    path: z.string().max(200).default(""),
    yes: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    no: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .strict()
  .refine((s) => JSON.stringify(s.yes) !== JSON.stringify(s.no), "yes and no must differ");

export type HttpSpec = z.infer<typeof specSchema>;

export function parseHttpKey(key: string): HttpSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(key);
  } catch {
    throw new Error('http key must be JSON: {"url","path","yes","no"}');
  }
  return specSchema.parse(raw);
}

export function canonicalHttpKey(key: string): string {
  const s = parseHttpKey(key);
  return JSON.stringify({ no: s.no, path: s.path, url: s.url, yes: s.yes });
}

/** Dotted path lookup with numeric array indexes: "data.0.status". */
export function readPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? cur[Number(part)] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function outcomeFromValue(spec: HttpSpec, value: unknown): boolean | null {
  const v = JSON.stringify(value ?? null);
  if (v === JSON.stringify(spec.yes)) return true;
  if (v === JSON.stringify(spec.no)) return false;
  return null;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80");
}

async function assertPublicUrl(raw: string, allowInsecure: boolean) {
  const u = new URL(raw);
  if (allowInsecure) return;
  if (u.protocol !== "https:") throw new Error("http source requires https");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("host resolves to a non-public address");
}

export async function fetchJson(url: string, opts: { allowInsecure: boolean; fetchImpl?: typeof fetch }): Promise<unknown> {
  await assertPublicUrl(url, opts.allowInsecure);
  const res = await (opts.fetchImpl ?? fetch)(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
    headers: { accept: "application/json", "user-agent": "Verdict-Relay/1" },
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 256 * 1024) throw new Error("response too large");
  return JSON.parse(text);
}

export class HttpSource implements ResultSource {
  readonly name = "http";
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: Db,
    private readonly opts: { allowInsecure: boolean; fetchImpl?: typeof fetch } = { allowInsecure: false },
  ) {}

  normalizeKey(key: string): string {
    return canonicalHttpKey(key);
  }

  private get(url: string) {
    let p = this.cache.get(url);
    if (!p) {
      p = fetchJson(url, this.opts);
      this.cache.set(url, p);
    }
    return p;
  }

  async getOutcome(conditionId: Hex): Promise<boolean | null> {
    const cond = await getCondition(this.db, conditionId);
    if (!cond || cond.source !== this.name) return null;
    const spec = parseHttpKey(cond.key);
    return outcomeFromValue(spec, readPath(await this.get(spec.url), spec.path));
  }

  async describe(key: string): Promise<string> {
    const spec = parseHttpKey(key);
    const value = readPath(await this.get(spec.url), spec.path);
    const host = new URL(spec.url).host;
    return `${host} ${spec.path || "(root)"} = ${JSON.stringify(spec.yes)} (currently ${JSON.stringify(value ?? null).slice(0, 40)})`;
  }
}
