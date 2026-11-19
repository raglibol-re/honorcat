/**
 * The HonorCat worker: everything that runs in the background, on one small always-on host
 * (Render), so the website (Vercel) only serves visitors.
 *
 * - the relay loop: indexing, housekeeping, perp rolls, honor and the daily honor root (runTick),
 *   every few seconds;
 * - the app's own sampler (SAMPLER_KEY), and optionally a second sampler (SAMPLER_KEY_GITHUB) with
 *   its own Gemini WebSocket;
 * - the samplers' HTTP API (the same routes and checks as the website's), so samplers elsewhere
 *   (the laptop) talk to this host instead of the website: /api/hc/sampler/{work,average,cosign,
 *   level,knock} and /api/early/{armed,:id/sign,:id/samples};
 * - GET /health for an uptime monitor (also what keeps a free Render service awake).
 *
 * Run: cd relay && node node_modules/tsx/dist/cli.mjs scripts/worker.ts   (PORT, and the app's env)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { getDb } from "../src/db";
import { armedPots, submitEarlySamples, submitEarlySignature, type SamplerSubmission } from "../src/early";
import { openKnockWindow, openLevelWindow, potsWork, submitAverage, submitCosig } from "../src/pots";
import { PotSampler, type PotsIo } from "../src/potsSampler";
import { WsBookSource } from "../src/sampler";
import { runAppSampler } from "../src/samplerHost";
import { runTick } from "../src/tick";
import { catalogTick } from "../src/catalogTick";

const started = Date.now();
const stats = { ticks: 0, tickErrors: 0, lastTickAt: 0, lastTickError: null as string | null, samplerBursts: 0, second: null as string | null, requests: 0 };
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((s) => getAddress(s) as Address);
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const averageBody = z.object({
  signer: address,
  record: z.record(z.string(), z.unknown()),
  signature: hex,
  average: z.object({ priceYes: z.number().int().min(0).max(1_000_000), valid: z.boolean(), sampleCount: z.number().int().nonnegative(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).optional(),
});
const cosignBody = z.object({ signer: address, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) });
const knockBody = z.object({ potId: z.string().regex(/^\d+$/), windowEnd: z.number().int().positive() });
const levelBody = z.object({ potId: z.string().regex(/^\d+$/), side: z.union([z.literal(0), z.literal(1)]), kind: z.number().int().min(2).max(5), windowEnd: z.number().int().positive() });
const signBody = z.union([
  z.object({ kind: z.literal("trigger"), record: z.record(z.string(), z.unknown()), attestation: hex, resolution: hex }),
  z.object({ kind: z.enum(["close", "void", "settle"]), signer: address, outcome: z.boolean(), resolution: hex, reason: z.string().max(300), observed: z.record(z.string(), z.unknown()) }),
]);
const samplesBody = z.object({
  signer: address,
  samples: z.array(z.object({ t: z.number().int(), mid: z.number().min(0).max(1).nullable(), status: z.number().int().min(0).max(7) })).max(500),
  signature: hex,
});

async function body(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw Object.assign(new Error("body too large"), { status: 413 });
  }
  return raw ? (JSON.parse(raw) as unknown) : null;
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://worker");
  const p = url.pathname;
  const db = await getDb();
  if (p === "/" || p === "/health") return send(res, 200, { ok: true, upSince: started, ...stats });
  if (req.method === "GET" && p === "/api/hc/sampler/work") {
    const signer = address.parse(url.searchParams.get("signer"));
    return send(res, 200, await potsWork(db, signer));
  }
  if (req.method === "POST" && p === "/api/hc/sampler/average") {
    const b = averageBody.parse(await body(req));
    return send(
      res,
      200,
      await submitAverage(db, url.searchParams.get("id") ?? "", {
        signer: b.signer,
        record: b.record,
        signature: b.signature as Hex,
        average: b.average && { ...b.average, signature: b.average.signature as Hex },
      }),
    );
  }
  if (req.method === "POST" && p === "/api/hc/sampler/cosign") {
    const b = cosignBody.parse(await body(req));
    return send(res, 200, await submitCosig(db, url.searchParams.get("id") ?? "", { signer: b.signer, signature: b.signature as Hex }));
  }
  if (req.method === "POST" && p === "/api/hc/sampler/knock") return send(res, 200, { id: await openKnockWindow(db, knockBody.parse(await body(req))) });
  if (req.method === "POST" && p === "/api/hc/sampler/level") return send(res, 200, { id: await openLevelWindow(db, levelBody.parse(await body(req))) });
  if (req.method === "GET" && p === "/api/early/armed") {
    const s = url.searchParams.get("signer");
    return send(res, 200, { pots: await armedPots(db, s && /^0x[0-9a-fA-F]{40}$/.test(s) ? (s as Address) : undefined) });
  }
  const early = p.match(/^\/api\/early\/([^/]+)\/(sign|samples)$/);
  if (req.method === "POST" && early) {
    const id = decodeURIComponent(early[1]!);
    if (early[2] === "sign") return send(res, 200, await submitEarlySignature(db, id, signBody.parse(await body(req)) as SamplerSubmission));
    const b = samplesBody.parse(await body(req));
    return send(res, 200, await submitEarlySamples(db, id, b.signer, b.samples, b.signature as Hex));
  }
  return send(res, 404, { error: "not found" });
}

createServer((req, res) => {
  stats.requests++;
  route(req, res).catch((err: unknown) => {
    const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : err instanceof z.ZodError ? 400 : 400;
    const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : ((err as Error)?.message ?? String(err));
    if (!res.headersSent) send(res, status, { error: message });
  });
}).listen(Number(process.env.PORT ?? 10000), () => log(`worker listening on :${process.env.PORT ?? 10000}`));

// The relay loop: runTick keeps its own lease and minimum interval, so a tick never overlaps another.
void (async () => {
  for (;;) {
    try {
      const r = await runTick({ reason: "worker" });
      stats.ticks++;
      stats.lastTickAt = Date.now();
      if (r.errors.length) {
        stats.lastTickError = r.errors[0]!;
        log(`tick errors: ${r.errors.join(" | ").slice(0, 300)}`);
      }
    } catch (err) {
      stats.tickErrors++;
      stats.lastTickError = (err as Error).message.slice(0, 200);
      log(`tick failed: ${stats.lastTickError}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
})();

// The market catalogue: events and order books (markets are offered only with a fresh book).
void (async () => {
  for (;;) {
    try {
      const r = await catalogTick(await getDb());
      if (r) log(`catalogue: ${r.books} books, ${r.rows} rows`);
    } catch (err) {
      log(`catalogue: ${(err as Error).message.slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
})();

// The app's own sampler (SAMPLER_KEY), in bursts as on the website, now back to back.
void (async () => {
  if (!process.env.SAMPLER_KEY) return log("no SAMPLER_KEY: the app's sampler is off");
  for (;;) {
    try {
      const s = await runAppSampler(await getDb(), { budgetMs: 30_000 });
      if (s.ran) stats.samplerBursts++;
    } catch (err) {
      log(`app sampler: ${(err as Error).message.slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
})();

// Optionally a second, independent sampler key on its own Gemini WebSocket (direct database access).
void (async () => {
  const key = process.env.SAMPLER_KEY_GITHUB;
  if (!key) return;
  const db = await getDb();
  const io: PotsIo = {
    work: (signer) => potsWork(db, signer),
    average: (id, b) => submitAverage(db, id, b),
    cosign: (id, b) => submitCosig(db, id, b),
    level: (b) => openLevelWindow(db, b),
    knock: (b) => openKnockWindow(db, b),
  };
  const account = privateKeyToAccount(key as Hex);
  const sampler = new PotSampler(account, new WsBookSource(), io, (m) => log(`[sampler2] ${m}`));
  stats.second = account.address;
  log(`second sampler ${account.address}`);
  for (;;) {
    await sampler.step().catch((e) => log(`[sampler2] step failed: ${(e as Error).message.slice(0, 160)}`));
    await new Promise((r) => setTimeout(r, 500));
  }
})();
