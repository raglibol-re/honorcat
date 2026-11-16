import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "./chain";
import { getConfig } from "./config";
import { getState, setState, type Db } from "./db";
import { armedPots, submitEarlySamples, submitEarlySignature } from "./early";
import { RestBookSource, Sampler, type SamplerIo } from "./sampler";
import { openLevelWindow, potsWork, submitAverage, submitCosig } from "./pots";
import { PotSampler, type PotsIo } from "./potsSampler";
import type { Sample } from "./trigger/engine";

/**
 * The Vercel app's own sampler (one of the three signers). Serverless functions are short-lived,
 * so it runs in bursts of `budgetMs` after API requests and Streams deliveries, guarded by a lease
 * so only one burst samples at a time, polls Gemini's REST order book, and keeps its samples in
 * the database between bursts. Gaps between bursts count as missing data (never as a trigger).
 */
const LEASE_KEY = "sampler_lease";

function directIo(db: Db): SamplerIo {
  return {
    armed: (signer) => armedPots(db, signer),
    submit: (id, sub) => submitEarlySignature(db, id, sub),
    samples: (id, signer, samples, signature) => submitEarlySamples(db, id, signer, samples, signature),
  };
}

function potsDirectIo(db: Db): PotsIo {
  return {
    work: (signer) => potsWork(db, signer),
    average: (id, body) => submitAverage(db, id, body),
    cosign: (id, body) => submitCosig(db, id, body),
    level: (body) => openLevelWindow(db, body),
  };
}

const ser = (s: Sample[]) => JSON.stringify(s.map((x) => ({ ...x, bid: x.bid.toString(), ask: x.ask.toString(), bidSize: x.bidSize.toString(), askSize: x.askSize.toString() })));
const de = (j: string): Sample[] =>
  (JSON.parse(j) as Record<string, string | number>[]).map((x) => ({
    t: Number(x.t),
    dataT: Number(x.dataT),
    bid: BigInt(x.bid!),
    ask: BigInt(x.ask!),
    bidSize: BigInt(x.bidSize!),
    askSize: BigInt(x.askSize!),
    status: Number(x.status) as Sample["status"],
  }));

export async function runAppSampler(db: Db, opts: { budgetMs: number }): Promise<{ ran: boolean; pots: number }> {
  const cfg = getConfig();
  if (!cfg.samplerKey || !cfg.early) return { ran: false, pots: 0 };
  const now = Date.now();
  const holder = randomUUID();
  // Atomic lease: take it only if absent or expired.
  const got = await db.query(
    `INSERT INTO relay_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
     WHERE split_part(relay_state.value, '|', 2)::bigint < $3
     RETURNING key`,
    [LEASE_KEY, `${holder}|${now + opts.budgetMs + 5_000}`, now],
  );
  if (got.length === 0) return { ran: false, pots: 0 };

  const sampler = new Sampler(
    privateKeyToAccount(cfg.samplerKey as `0x${string}`),
    new RestBookSource(),
    directIo(db),
    publicClient(),
    (m) => console.log(`[sampler:vercel] ${m}`),
    {
      load: async (id) => {
        const v = await getState(db, `sampler_samples:${id}`);
        return v ? de(v) : [];
      },
      save: (id, s) => setState(db, `sampler_samples:${id}`, ser(s)),
    },
  );
  const account = privateKeyToAccount(cfg.samplerKey as `0x${string}`);
  const potSampler = cfg.pots
    ? new PotSampler(account, new RestBookSource(), potsDirectIo(db), (m) => console.log(`[pots:vercel] ${m}`), {
        load: async (i) => {
          const v = await getState(db, `pot_samples:${i}`);
          return v ? de(v) : [];
        },
        save: (i, s) => setState(db, `pot_samples:${i}`, ser(s)),
      })
    : null;
  const steps = async () => {
    await sampler.step().catch((e) => console.error("[sampler:vercel]", (e as Error).message));
    if (potSampler) await potSampler.step().catch((e) => console.error("[pots:vercel]", (e as Error).message));
  };
  try {
    const end = now + opts.budgetMs;
    await steps();
    if (sampler.watching === 0 && !potSampler?.busy) return { ran: true, pots: 0 };
    while (Date.now() < end) {
      await steps();
      await new Promise((r) => setTimeout(r, 250));
    }
    return { ran: true, pots: sampler.watching + (potSampler?.watching ?? 0) };
  } finally {
    await setState(db, LEASE_KEY, `${holder}|0`);
  }
}
