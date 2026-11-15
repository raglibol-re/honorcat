/**
 * Runs one independent HonorCat sampler: Gemini's public order book over WebSocket (depth5), its
 * own samples and decisions, signatures with its own key. Used on the local machine and in GitHub
 * Actions (the Vercel app runs the third sampler itself).
 *
 * Usage:
 *   pnpm --filter @honorcat/relay sampler -- --api https://honorcat.vercel.app --key-env SAMPLER_KEY_LOCAL
 * Options: --idle-exit <s> (exit after this long without pots; default never), --max <s> (stop after).
 * Env: the key variable named by --key-env, ARC_RPC_URL (optional).
 */
import { parseArgs } from "node:util";
import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { httpIo, Sampler, WsBookSource } from "../src/sampler";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    api: { type: "string", default: "https://honorcat.vercel.app" },
    "key-env": { type: "string", default: "SAMPLER_KEY_LOCAL" },
    "idle-exit": { type: "string" },
    max: { type: "string" },
  },
});

const key = process.env[values["key-env"]!];
if (!key) throw new Error(`${values["key-env"]} is not set`);
const account = privateKeyToAccount(key as Hex);
const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io") });
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const source = new WsBookSource();
const sampler = new Sampler(account, source, httpIo(values.api!), client as never, log);

const started = Date.now();
const idleExit = values["idle-exit"] ? Number(values["idle-exit"]) * 1000 : Infinity;
const maxMs = values.max ? Number(values.max) * 1000 : Infinity;
let lastBusy = Date.now();
let lastLog = 0;
log(`sampler ${account.address} watching ${values.api} (Gemini depth5 over WebSocket)`);

for (;;) {
  try {
    await sampler.step();
  } catch (err) {
    log(`step failed: ${(err as Error).message.split("\n")[0]}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const now = Date.now();
  if (sampler.watching > 0) lastBusy = now;
  if (now - lastLog > 60_000) {
    lastLog = now;
    log(`watching ${sampler.watching} pot(s)`);
  }
  if (now - lastBusy > idleExit || now - started > maxMs) break;
  await new Promise((r) => setTimeout(r, 250));
}
source.close();
log("sampler stopped");
process.exit(0);
