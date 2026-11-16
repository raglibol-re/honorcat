import { randomUUID } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

/**
 * The relay's sender for HonorCat pots: a Circle developer-controlled EOA wallet on Arc testnet.
 * Circle holds the key (MPC) and signs; the app only holds an API key and the entity secret, from
 * which a fresh single-use ciphertext is made per request. Every pot transaction the relay sends
 * (attestations, settlements, housekeeping, gifts, the practice cat) goes through it.
 *
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_RELAY_WALLET_ID, CIRCLE_RELAY_WALLET_ADDRESS.
 */
type Client = ReturnType<typeof initiateDeveloperControlledWalletsClient>;
let client: Client | null = null;

export function circleRelay(): { walletId: string; address: Address } | null {
  const id = process.env.CIRCLE_RELAY_WALLET_ID;
  const addr = process.env.CIRCLE_RELAY_WALLET_ADDRESS;
  if (!id || !addr || !process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) return null;
  return { walletId: id, address: getAddress(addr) };
}

function sdk(): Client {
  client ??= initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! });
  return client;
}

const FINAL_FAIL = new Set(["FAILED", "DENIED", "CANCELLED", "STUCK"]);

/**
 * Sends `data` to `to` from the Circle relay wallet (contract execution with raw call data) and
 * returns the transaction hash as soon as Circle has broadcast it. Arc finalises in under a second;
 * the caller waits for the receipt as for any other transaction.
 */
export async function sendViaCircle(to: Address, data: Hex, refId?: string): Promise<Hex> {
  const w = circleRelay();
  if (!w) throw new Error("the Circle relay wallet is not configured");
  const res = await sdk().createContractExecutionTransaction({
    walletId: w.walletId,
    contractAddress: to,
    callData: data,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: randomUUID(),
    refId: refId?.slice(0, 100),
  } as never);
  const id = (res.data as { id?: string } | undefined)?.id;
  if (!id) throw new Error("Circle did not accept the transaction");
  const deadline = Date.now() + 60_000;
  for (;;) {
    const t = await sdk().getTransaction({ id });
    const tx = t.data?.transaction as { state?: string; txHash?: string; errorReason?: string; errorDetails?: string } | undefined;
    if (tx?.txHash) return tx.txHash as Hex;
    if (tx?.state && FINAL_FAIL.has(tx.state)) throw new Error(`Circle ${tx.state.toLowerCase()}: ${tx.errorReason ?? tx.errorDetails ?? "no reason given"}`);
    if (Date.now() > deadline) throw new Error(`Circle transaction ${id} not broadcast within 60 s (state ${tx?.state ?? "unknown"})`);
    await new Promise((r) => setTimeout(r, 700));
  }
}
