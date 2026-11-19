/**
 * Reads or updates the QuickNode Stream through QuickNode's REST API (Streams v1).
 * Env: QUICKNODE_API_KEY, QUICKNODE_STREAM_ID. Never prints the key or the security token.
 *
 *   tsx --env-file=../.env scripts/quicknode-stream.ts            # show settings
 *   tsx --env-file=../.env scripts/quicknode-stream.ts --batch 10 # set batch size (elastic off)
 *   tsx --env-file=../.env scripts/quicknode-stream.ts --filter --status active  # upload filter, resume
 *   tsx --env-file=../.env scripts/quicknode-stream.ts --url https://…/api/webhooks/quicknode  # webhook address
 */
import { parseArgs } from "node:util";
import { STREAMS_FILTER_TEMPLATE } from "../src/indexer/quicknode";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { batch: { type: "string" }, status: { type: "string" }, filter: { type: "boolean" }, url: { type: "string" } },
});
const key = process.env.QUICKNODE_API_KEY;
const id = process.env.QUICKNODE_STREAM_ID;
if (!key || !id) throw new Error("QUICKNODE_API_KEY and QUICKNODE_STREAM_ID must be set");
const url = `https://api.quicknode.com/streams/rest/v1/streams/${encodeURIComponent(id)}`;

async function call(method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "x-api-key": key!, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

function summary(j: Record<string, unknown> | null) {
  if (!j) return null;
  const pick = ["id", "name", "network", "dataset", "status", "dataset_batch_size", "elastic_batch_enabled", "start_range", "end_range", "keep_distance_from_tip", "fix_block_reorgs", "region", "destination"];
  const out: Record<string, unknown> = Object.fromEntries(pick.map((k) => [k, j[k]]));
  const attrs = j.destination_attributes as Record<string, unknown> | undefined;
  out.destination_url = attrs?.url;
  out.filter_set = typeof j.filter_function === "string" && j.filter_function.length > 0;
  return out;
}

const before = await call("GET");
console.log("GET", before.status, JSON.stringify(summary(before.json) ?? before.text.slice(0, 300), null, 1));

if (values.batch || values.status || values.filter || values.url) {
  const patch: Record<string, unknown> = {};
  if (values.filter) {
    // Fill in our addresses (lowercase) from the env and upload base64-encoded, as the API requires.
    const vault = process.env.VAULT_ADDRESS?.toLowerCase();
    const book = process.env.GUARANTEE_BOOK_ADDRESS?.toLowerCase();
    const merkle = process.env.MERKLE_BOOK_ADDRESS?.toLowerCase();
    if (!vault || !book || !merkle) throw new Error("VAULT_ADDRESS, GUARANTEE_BOOK_ADDRESS and MERKLE_BOOK_ADDRESS must be set");
    // The two-sided pot contract (HonorCatPots): POTS_ADDRESS or deployments/<chain>.pots.json.
    const { readFileSync } = await import("node:fs");
    const potsFile = (() => {
      try {
        return JSON.parse(readFileSync(new URL("../../deployments/5042002.pots.json", import.meta.url), "utf8")) as { pots: string };
      } catch {
        return null;
      }
    })();
    const pots = (process.env.POTS_ADDRESS ?? potsFile?.pots)?.toLowerCase();
    if (!pots) throw new Error("POTS_ADDRESS (or deployments/5042002.pots.json) must be set");
    // HonorCat v2 (every HonorCatRopes deployment) and HonorCatPerps, from deployments/*.ropes*.json.
    const extra: string[] = [];
    for (const f of ["5042002.ropes.json", "5042002.ropes-v20.json"]) {
      try {
        const d = JSON.parse(readFileSync(new URL(`../../deployments/${f}`, import.meta.url), "utf8")) as { ropes?: string; perps?: string };
        if (d.ropes) extra.push(d.ropes.toLowerCase());
        if (d.perps) extra.push(d.perps.toLowerCase());
      } catch {
        /* not deployed */
      }
    }
    // Group pots (HonorCatGroups) and the daily honor roots (HonorRoots).
    for (const [f, k] of [["5042002.groups.json", "groups"], ["5042002.honor.json", "honorRoots"]] as const) {
      try {
        const d = JSON.parse(readFileSync(new URL(`../../deployments/${f}`, import.meta.url), "utf8")) as Record<string, string>;
        const a = d[k] ?? Object.values(d).find((v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v));
        if (a) extra.push(a.toLowerCase());
      } catch {
        /* not deployed */
      }
    }
    console.log("filter addresses:", [vault, book, merkle, pots, ...extra].length);
    const code = STREAMS_FILTER_TEMPLATE.replace("<VAULT_ADDRESS_LOWERCASE>", vault)
      .replace("<EXTRA_ADDRESSES_LOWERCASE>", extra.map((a) => `, "${a}"`).join(""))
      .replace("<GUARANTEE_BOOK_ADDRESS_LOWERCASE>", book)
      .replace("<MERKLE_BOOK_ADDRESS_LOWERCASE>", merkle)
      .replace("<POTS_ADDRESS_LOWERCASE>", pots);
    patch.filter_function = Buffer.from(code, "utf8").toString("base64");
  }
  if (values.batch) {
    patch.dataset_batch_size = Number(values.batch);
    patch.elastic_batch_enabled = false;
  }
  if (values.status) patch.status = values.status;
  // The webhook address; the rest of the destination (its security token) stays as it is.
  if (values.url) patch.destination_attributes = { ...((before.json?.destination_attributes as Record<string, unknown>) ?? {}), url: values.url };
  const res = await call("PATCH", patch);
  console.log("PATCH", res.status, JSON.stringify(summary(res.json) ?? res.json ?? res.text.slice(0, 500), null, 1));
  if (res.status >= 400) console.log("error body:", res.text.slice(0, 800));
}
