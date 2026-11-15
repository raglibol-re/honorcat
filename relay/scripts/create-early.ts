/**
 * Creates a funded early payout through the public API, signed by DEPLOYER_PRIVATE_KEY (the funder).
 *
 *   pnpm --filter @verdict/relay exec tsx --env-file=../.env scripts/create-early.ts -- \
 *     --name "HonorCat" --event <EVENT> --contract <CONTRACT> --side yes --places 50 --amount 0.10 --join-minutes 120
 *
 * Without --event/--contract it uses the best-suited live contract from /api/early/demo.
 * Real Gemini market only; --unlisted keeps it out of product lists.
 */
import { parseArgs } from "node:util";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    api: { type: "string", default: "https://verdict-phi-livid.vercel.app" },
    name: { type: "string" },
    event: { type: "string" },
    contract: { type: "string" },
    side: { type: "string" },
    mode: { type: "string", default: "early-only" },
    threshold: { type: "string", default: "85" },
    amount: { type: "string", default: "0.10" },
    places: { type: "string", default: "10" },
    "join-minutes": { type: "string", default: "60" },
    template: { type: "string" },
    unlisted: { type: "boolean", default: false },
  },
});
if (!values.name) throw new Error("--name is required");
const API = values.api!.replace(/\/$/, "");
const funder = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(API + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`);
  return JSON.parse(t) as T;
}

let event = values.event;
let contract = values.contract;
let side = values.side as "yes" | "no" | undefined;
if (!event || !contract) {
  const d = await api<{ trigger: { eventTicker: string; contractTicker: string; side: "yes" | "no"; title: string; label: string; chance: number }[] }>("/api/early/demo");
  const c = d.trigger[0];
  if (!c) throw new Error("no live contract meets the rules right now");
  ({ eventTicker: event, contractTicker: contract } = c);
  side ??= c.side;
  console.log(`market: ${c.title} — ${c.label} (${c.side.toUpperCase()} at ${(c.chance * 100).toFixed(1)}%)`);
}

type Prepared = {
  terms: Record<string, unknown> & { promise: string; lockTime: number; template: string };
  seal: string;
  salt: Hex;
  validAfter: string;
  validBefore: string;
  typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, string> };
};
const prep = await api<Prepared>("/api/early/prepare", {
  name: values.name,
  funder: funder.address,
  eventTicker: event,
  contractTicker: contract,
  side: side ?? "yes",
  mode: values.mode,
  thresholdBps: Math.round(Number(values.threshold) * 100),
  amount: values.amount,
  maxRecipients: Number(values.places),
  joinSeconds: Math.round(Number(values["join-minutes"]) * 60),
  template: values.template,
  listed: !values.unlisted,
});
const m = prep.typedData.message;
const signature = await funder.signTypedData({
  domain: { ...prep.typedData.domain, chainId: Number(prep.typedData.domain.chainId) },
  types: prep.typedData.types,
  primaryType: prep.typedData.primaryType,
  message: { ...m, value: BigInt(m.value!), validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) },
} as never);
const created = await api<{ id: string; potId: string; tx: Hex }>("/api/early", {
  terms: prep.terms,
  seal: prep.seal,
  authorization: { from: funder.address, validAfter: prep.validAfter, validBefore: prep.validBefore, salt: prep.salt, signature },
});
console.log(`created ${created.id} (pot #${created.potId}, ${prep.terms.template} rule): ${prep.terms.promise}`);
console.log(`${API}/e/${created.id}`);
