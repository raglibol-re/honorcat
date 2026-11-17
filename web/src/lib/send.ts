import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { getJson } from "@/lib/api";
import { publicClient, USDC_ADDRESS } from "@/lib/chain";
import type { Actor } from "@/lib/hc";
import { signChallenge } from "@/lib/passkey";

export type Player = { account: Address; name: string | null; fur: string | null };

export async function findPlayers(q: string): Promise<Player[]> {
  if (q.trim().length < 2) return [];
  return (await getJson<{ players: Player[] }>(`/api/hc/players?q=${encodeURIComponent(q.trim())}`)).players;
}

const post = <T,>(path: string, body: unknown) => getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * Sends test USDC to another account. A passkey player signs the transfer with the passkey and
 * HonorCat pays the network fee; a wallet player sends it from the wallet (fee in USDC).
 * `potId` marks it as a share of that pot in the memo.
 */
export async function sendUsdc(actor: Actor, to: Address, value: bigint, potId?: string, onStep?: (s: string) => void): Promise<Hex> {
  if (actor.kind === "passkey") {
    const p = await post<{ challenge: Hex; deadline: string }>("/api/hc/send/prepare", { account: actor.account, to, value: value.toString() });
    onStep?.("Confirm with your passkey");
    const assertion = await signChallenge(actor.session, p.challenge);
    onStep?.("Sending");
    return (await post<{ tx: Hex }>("/api/hc/send", { account: actor.account, to, value: value.toString(), deadline: p.deadline, assertion, ...(potId ? { potId } : {}) })).tx;
  }
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, value] });
  onStep?.("Confirm the transfer in your wallet");
  const tx = await actor.adapter.send({ to: USDC_ADDRESS, data });
  onStep?.("Waiting for Arc to confirm");
  const r = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 60_000 }).catch(() => null);
  if (r && r.status !== "success") throw new Error("The transfer failed on Arc. Nothing was sent except the network fee.");
  return tx;
}
