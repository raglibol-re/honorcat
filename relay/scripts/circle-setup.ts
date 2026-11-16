/**
 * One-time setup of Circle developer-controlled wallets for the relay:
 *   1. a random 32-byte entity secret, registered with Circle (encrypted with Circle's public key);
 *      Circle's recovery file is saved OUTSIDE the repository (it can only be downloaded once);
 *   2. a wallet set and one EOA wallet on ARC-TESTNET, which sends every relay transaction from now on;
 *   3. CIRCLE_ENTITY_SECRET, CIRCLE_RELAY_WALLET_ID and CIRCLE_RELAY_WALLET_ADDRESS stored in the
 *      local .env and in Vercel (Production). Secrets are never printed.
 * Env: CIRCLE_API_KEY. Usage: tsx --env-file=../.env scripts/circle-setup.ts
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { initiateDeveloperControlledWalletsClient, registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) throw new Error("CIRCLE_API_KEY is not set");
const envFile = join(process.cwd(), "..", ".env");
if (/^CIRCLE_ENTITY_SECRET=/m.test(readFileSync(envFile, "utf8"))) throw new Error("CIRCLE_ENTITY_SECRET already exists in .env; refusing to register a second one");

const entitySecret = randomBytes(32).toString("hex");
const recoveryDir = join(homedir(), "honorcat-circle-recovery");
mkdirSync(recoveryDir, { recursive: true });
await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: recoveryDir });
console.log(`entity secret registered; Circle's recovery file saved in ${recoveryDir} (keep it safe, outside the repository)`);

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const set = await client.createWalletSet({ name: "HonorCat relay" });
const walletSetId = set.data?.walletSet?.id;
if (!walletSetId) throw new Error("no wallet set id");
const w = await client.createWallets({ walletSetId, blockchains: ["ARC-TESTNET"], count: 1, accountType: "EOA", metadata: [{ name: "HonorCat relay", refId: "relay" }] });
const wallet = w.data?.wallets?.[0];
if (!wallet) throw new Error("no wallet created");
console.log(`relay wallet on Arc testnet: ${wallet.address} (id ${wallet.id})`);

const vars: [string, string][] = [
  ["CIRCLE_ENTITY_SECRET", entitySecret],
  ["CIRCLE_RELAY_WALLET_ID", wallet.id],
  ["CIRCLE_RELAY_WALLET_ADDRESS", wallet.address],
];
appendFileSync(envFile, `\n${vars.map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
for (const [k, v] of vars) execSync(`npx vercel env add ${k} production`, { input: v, stdio: ["pipe", "ignore", "inherit"], cwd: join(process.cwd(), "..") });
console.log("stored in .env and in Vercel (Production)");
