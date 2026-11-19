// Usage: node scripts/check-secrets.mjs . https://honorcat.vercel.app
// Looks for every secret value from .env (never printed) in the full git history and in every
// JavaScript chunk the production site serves. Prints only names and counts.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const [repo, site] = process.argv.slice(2);
const env = Object.fromEntries(
  readFileSync(`${repo}/.env`, "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
// Addresses are public (e.g. PASSKEY_FACTORY_ADDRESS); only secret-looking names are checked.
const secretNames = Object.keys(env).filter((k) => /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|PRIVATE/.test(k) && !/_ADDRESS$/.test(k) && env[k].length >= 12);
const secrets = secretNames.map((k) => [k, env[k], env[k].replace(/^0x/, "")]);
console.log(`secret values checked: ${secretNames.length} (${secretNames.join(", ")})`);

const history = execSync("git log -p --all --no-color", { cwd: repo, maxBuffer: 1 << 30 }).toString();
const tracked = execSync("git ls-files", { cwd: repo }).toString().split("\n");
console.log(`git history: ${history.length} bytes, ${tracked.length} tracked files, .env tracked: ${tracked.includes(".env")}`);
let hits = 0;
for (const [k, v, bare] of secrets) if (history.includes(v) || history.includes(bare)) (hits++, console.log(`  FOUND in history: ${k}`));
console.log(`git history hits: ${hits}`);

const pages = ["/", "/guarantees", "/guarantees/new", "/account", "/live", "/status", "/ledger", "/developers", "/pots"];
const chunks = new Set();
for (const p of pages) {
  const html = await fetch(site + p).then((r) => r.text());
  for (const m of html.matchAll(/\/_next\/static\/[^"'\s)]+\.js/g)) chunks.add(m[0]);
}
let bytes = 0;
let bundleHits = 0;
const generic = { privateKeyLike: 0 };
for (const c of chunks) {
  const js = await fetch(site + c).then((r) => r.text());
  bytes += js.length;
  for (const [k, v, bare] of secrets) if (js.includes(v) || js.includes(bare)) (bundleHits++, console.log(`  FOUND in bundle: ${k} (${c})`));
  for (const name of secretNames) if (js.includes(name)) console.log(`  env var NAME appears in bundle: ${name} (${c})`);
}
console.log(`production bundle: ${chunks.size} JS chunks, ${bytes} bytes, secret value hits: ${bundleHits}`);
