/**
 * Creates the QuickNode Stream (Streams REST v1) from the current block: Arc testnet logs, our
 * filter (every HonorCat contract plus Memo logs of our transactions), the webhook on the site,
 * batch size 1, active. Writes QUICKNODE_STREAM_ID and QUICKNODE_STREAMS_TOKEN into ../.env.
 * Never prints the API key or the security token.
 *
 *   tsx --env-file=../.env scripts/quicknode-create.ts [--url https://honorcat.vercel.app/api/webhooks/quicknode]
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { STREAMS_FILTER_TEMPLATE } from "../src/indexer/quicknode";

const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { url: { type: "string", default: "https://honorcat.vercel.app/api/webhooks/quicknode" } } });
const key = process.env.QUICKNODE_API_KEY;
if (!key) throw new Error("QUICKNODE_API_KEY must be set");

const dep = (f: string) => {
  try {
    return JSON.parse(readFileSync(new URL(`../../deployments/${f}`, import.meta.url), "utf8")) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
};
const lower = (a?: string) => (a && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null);
const vault = lower(process.env.VAULT_ADDRESS);
const book = lower(process.env.GUARANTEE_BOOK_ADDRESS);
const merkle = lower(process.env.MERKLE_BOOK_ADDRESS);
const pots = lower(process.env.POTS_ADDRESS ?? dep("5042002.pots.json").pots);
if (!vault || !book || !merkle || !pots) throw new Error("VAULT_ADDRESS, GUARANTEE_BOOK_ADDRESS, MERKLE_BOOK_ADDRESS and the pots deployment must be set");
const extra = [
  dep("5042002.ropes.json").ropes,
  dep("5042002.ropes.json").perps,
  dep("5042002.ropes-v20.json").ropes,
  dep("5042002.groups.json").groups,
  dep("5042002.honor.json").honorRoots,
]
  .map(lower)
  .filter((a): a is string => !!a);
const code = STREAMS_FILTER_TEMPLATE.replace("<VAULT_ADDRESS_LOWERCASE>", vault)
  .replace("<EXTRA_ADDRESSES_LOWERCASE>", extra.map((a) => `, "${a}"`).join(""))
  .replace("<GUARANTEE_BOOK_ADDRESS_LOWERCASE>", book)
  .replace("<MERKLE_BOOK_ADDRESS_LOWERCASE>", merkle)
  .replace("<POTS_ADDRESS_LOWERCASE>", pots);

// Start at the current block: no replay of the blocks the poller already covered.
const head = await fetch("https://rpc.testnet.arc.io", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })
  .then((r) => r.json())
  .then((j: { result: string }) => parseInt(j.result, 16));
const token = randomBytes(24).toString("hex");
const body = {
  name: "honorcat",
  network: "arc-testnet",
  dataset: "logs",
  filter_function: Buffer.from(code, "utf8").toString("base64"),
  region: "usa_east",
  start_range: head,
  end_range: -1,
  dataset_batch_size: 1,
  include_stream_metadata: "body",
  elastic_batch_enabled: true,
  fix_block_reorgs: 0,
  keep_distance_from_tip: 0,
  destination: "webhook",
  destination_attributes: { url: values.url, compression: "none", headers: { "Content-Type": "application/json" }, max_retry: 3, retry_interval_sec: 1, post_timeout_sec: 30, security_token: token },
  status: "active",
};
const res = await fetch("https://api.quicknode.com/streams/rest/v1/streams", {
  method: "POST",
  headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
});
const text = await res.text();
if (!res.ok) {
  console.log("create failed", res.status, text.replace(token, "[token]").slice(0, 600));
  process.exit(1);
}
const j = JSON.parse(text) as { id: string; status: string; destination_attributes?: { security_token?: string } };
const used = j.destination_attributes?.security_token || token;
console.log(`stream ${j.id} ${j.status}, from block ${head}, ${extra.length + 4} contracts, webhook ${values.url}`);

// Keep the id and the token in ../.env (never printed).
const envPath = new URL("../../.env", import.meta.url);
let env = readFileSync(envPath, "utf8");
const set = (name: string, v: string) => {
  const re = new RegExp(`^${name}=.*$`, "m");
  env = re.test(env) ? env.replace(re, `${name}=${v}`) : `${env.replace(/\s*$/, "")}\n${name}=${v}\n`;
};
set("QUICKNODE_STREAM_ID", j.id);
set("QUICKNODE_STREAMS_TOKEN", used);
writeFileSync(envPath, env);
console.log("QUICKNODE_STREAM_ID and QUICKNODE_STREAMS_TOKEN written to .env");
