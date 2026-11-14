/**
 * Creates a Verdict guarantee on a live Gemini market through the public API, signed by the
 * deployer key (the merchant). For demos and tests.
 *
 *   pnpm --filter @verdict/relay exec tsx --env-file=../.env scripts/create-guarantee.ts \
 *     --api https://verdict-phi-livid.vercel.app --template temperature --name "Demo merchant" --refund 0.50 --seats 10
 */
import { parseArgs } from "node:util";
import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    api: { type: "string", default: "https://verdict-phi-livid.vercel.app" },
    template: { type: "string", default: "temperature" },
    name: { type: "string" },
    refund: { type: "string", default: "0.50" },
    seats: { type: "string", default: "10" },
    side: { type: "string", default: "yes" },
    unlisted: { type: "boolean", default: false },
  },
});
if (!values.name) throw new Error("--name <merchant name> is required");
const API = values.api!.replace(/\/$/, "");
const merchant = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);

async function api<T>(path: string, json?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: json ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

type Markets = { markets: { ticker: string; title: string; expiry: string; contracts: { ticker: string; label: string; chanceYes: number | null }[] }[] };
const { markets } = await api<Markets>(`/api/markets?template=${values.template}`);
// The most informative contract: a live price closest to 50%.
let best: { m: Markets["markets"][number]; c: Markets["markets"][number]["contracts"][number] } | null = null;
for (const m of markets) for (const c of m.contracts) {
  if (c.chanceYes === null) continue;
  if (!best || Math.abs(c.chanceYes - 0.5) < Math.abs((best.c.chanceYes ?? 0) - 0.5)) best = { m, c };
}
if (!best) throw new Error(`no priced market for template ${values.template}`);

type Prep = {
  terms: Record<string, unknown> & { promise: string };
  seal: string;
  salt: Hex;
  validAfter: string;
  validBefore: string;
  typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, string> };
};
const prep = await api<Prep>("/api/guarantees/prepare", {
  template: values.template,
  eventTicker: best.m.ticker,
  contractTicker: best.c.ticker,
  side: values.side,
  merchantName: values.name,
  merchant: merchant.address,
  refund: values.refund,
  maxCustomers: Number(values.seats),
  listed: !values.unlisted,
});
const m = prep.typedData.message;
const signature = await merchant.signTypedData({
  domain: { ...prep.typedData.domain, chainId: Number(prep.typedData.domain.chainId) },
  types: prep.typedData.types,
  primaryType: prep.typedData.primaryType,
  message: { ...m, value: BigInt(m.value!), validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) },
} as unknown as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
const created = await api<{ id: string; potId: string; tx: Hex }>("/api/guarantees", {
  terms: prep.terms,
  seal: prep.seal,
  authorization: { from: merchant.address, validAfter: prep.validAfter, validBefore: prep.validBefore, salt: prep.salt, signature },
});
console.log(JSON.stringify({ ...created, promise: prep.terms.promise, url: `${API}/g/${created.id}` }, null, 2));
