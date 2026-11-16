/**
 * An agent plays a whole pot, end to end on production (testnet money only): a throwaway player gets
 * test USDC from HonorCat's pool, creates a $1 pot with its own transactions, invites its agent, and
 * creates a seat. Then, over MCP exactly as Grok Bot does, the agent takes the other side, sets a net,
 * and leaves, each with a one-line reason. The pot page then shows "played by an agent" with the
 * reasons. Leftovers go back to the pool.
 * Usage: tsx --env-file=../.env scripts/agent-play-e2e.ts [--symbol GEMI-…]
 */
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, parseEventLogs, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC_USDC } from "../src/arc";
import { potsAbi } from "../src/potsAbi";

const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { api: { type: "string", default: "https://honorcat.vercel.app" }, symbol: { type: "string" }, sitter: { type: "boolean" } } });
const API = values.api!.replace(/\/$/, "");
const rpc = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZERO = `0x${"0".repeat(64)}` as Hex;
const player = privateKeyToAccount(generatePrivateKey());
const POOL = "0xf1eb955bd6329285e39c87ade8199c9750bff569" as Address; // HonorCat's relay wallet (the test-money pool)

async function api<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(API + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t) as T;
}
async function send(to: Address, data: Hex) {
  const wc = createWalletClient({ account: player, chain: arcTestnet, transport: http(rpc) });
  const r = await client.waitForTransactionReceipt({ hash: await wc.sendTransaction({ to, data }) });
  if (r.status !== "success") throw new Error(`reverted: ${r.transactionHash}`);
  return r;
}

async function main() {
  // Test money from the pool, as any new player gets.
  await api("/api/hc/topup", { account: player.address, need: "1300000" });
  for (let i = 0; i < 20; i++) {
    const b = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [player.address] });
    if (b >= 1_000_000n) break;
    await sleep(1500);
  }
  log(`player ${player.address.slice(0, 10)}… funded from the pool`);

  // A $1 pot, the player's own transactions.
  const symbol = values.symbol ?? "GEMI-NFL-2611170115-LAC-BAL-M-BAL";
  type Prep = { conditionId: Hex; resolver: Address; pots: Address; closeTime: number; window: number; minSamples: number; depthId: string; depth: { conditionId: Hex; account: Address; contracts5c: string; closeTime: string; validUntil: string }; midPpm: number };
  const prep = await api<Prep>("/api/hc/prepare", { symbol, account: player.address });
  let sigs: Hex | null = null;
  for (let i = 0; i < 30 && !sigs; i++) {
    sigs = (await api<{ signatures: Hex | null }>(`/api/hc/depth?id=${encodeURIComponent(prep.depthId)}`)).signatures;
    if (!sigs) await sleep(1500);
  }
  if (!sigs) throw new Error("depth not co-signed");
  const notional = 1_000_000n;
  const c = { conditionId: prep.conditionId, resolver: prep.resolver, side: 0, notional, bandCenter: prep.midPpm, tolerance: 50_000, closeTime: BigInt(prep.closeTime), grace: 86_400n, window: prep.window, minSamples: prep.minSamples };
  const d = prep.depth;
  const escrow = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "worstCase", args: [0, notional, c.bandCenter, c.tolerance] });
  await send(ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [prep.pots, escrow] }));
  const r = await send(prep.pots, encodeFunctionData({
    abi: potsAbi,
    functionName: "create",
    args: [c, { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) }, sigs, { from: player.address, validAfter: 0n, validBefore: 0n, salt: ZERO, v: 0, r: ZERO, s: ZERO }],
  }));
  const potId = String((parseEventLogs({ abi: potsAbi, logs: r.logs, eventName: "PotCreated" })[0]!.args as { potId: bigint }).potId);
  await api(`/api/hc/pots/${potId}`, {});
  log(`player created pot ${potId}`);

  // Opponent mode: invite the agent. Sitter mode: the practice cat joins and the agent minds the player's side.
  if (!values.sitter) await api("/api/hc/agent/invite", { potId });
  else await api("/api/hc/practice", { potId });
  const issuedAt = new Date().toISOString();
  const label = "e2e Grok Bot";
  const seat = await api<{ id: string; token: string }>("/api/hc/agent/seats", {
    action: "create",
    account: player.address,
    label,
    issuedAt,
    signature: await player.signMessage({ message: `HonorCat: let my agent "${label}" play my practice pots.\nAccount: ${getAddress(player.address)}\nIssued: ${issuedAt}` }),
  });
  log(`seat ${seat.id} created`);

  // The agent, over MCP.
  let id = 0;
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(`${API}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${seat.token}`, "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
    });
    const t = await res.text();
    const line = t.split("\n").find((l) => l.startsWith("data:"));
    const j = JSON.parse(line ? line.slice(5) : t) as { result?: { content?: { text: string }[]; isError?: boolean } };
    const text = j.result?.content?.[0]?.text ?? t;
    log(`agent ${name}: ${text.replace(/\s+/g, " ").slice(0, 140)}`);
    if (j.result?.isError) throw new Error(`${name} refused: ${text}`);
    return text;
  };
  const waitState = async (want: string[]) => {
    for (let i = 0; i < 60; i++) {
      const s = await api<{ state: string }>(`/api/hc/pots/${potId}`);
      if (want.includes(s.state)) return s.state;
      await sleep(4000);
    }
    throw new Error(`timeout waiting for ${want.join("/")}`);
  };
  if (values.sitter) {
    log(`pot is ${await waitState(["Live"])}`);
    // The player lets the sitter mind it: nets need approval, the full exit is signed in advance (alone).
    const seatRow = (await api<{ seats: { id: string; expiresAt: string }[] }>(`/api/hc/agent/seats?account=${player.address}`)).seats.find((x) => x.id === seat.id)!;
    const deadline = Math.floor(Date.parse(seatRow.expiresAt) / 1000);
    const pots = prep.pots;
    const sigNonce = (await client.readContract({ address: pots, abi: potsAbi, functionName: "sigNonce", args: [BigInt(potId) * 2n] })) as bigint;
    const exitSig = await player.signTypedData({
      domain: { name: "HonorCatPots", version: "1", chainId: 5042002, verifyingContract: pots },
      types: { ExitRequest: [{ name: "potId", type: "uint256" }, { name: "side", type: "uint8" }, { name: "notional", type: "uint256" }, { name: "sigNonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "ExitRequest",
      message: { potId: BigInt(potId), side: 0, notional, sigNonce, deadline: BigInt(deadline) },
    });
    const powers = { setNet: "approval", setBowl: "off", partialExit: "off", fullExit: "alone", acceptHandshake: "approval" } as const;
    const at = new Date().toISOString();
    await api("/api/hc/agent/attach", {
      account: player.address,
      seatId: seat.id,
      potId,
      powers,
      exits: { full: { sig: exitSig, notional: notional.toString(), deadline } },
      issuedAt: at,
      signature: await player.signMessage({
        message: `HonorCat: let my cat sitter ${seat.id} mind pot ${potId}.
Powers: ${Object.entries(powers).map(([k, v]) => `${k}=${v}`).join(", ")}
Account: ${getAddress(player.address)}
Issued: ${at}`,
      }),
    });
    log("player attached the cat sitter (net with approval, full exit alone)");
    await tool("list_my_pots", {});
    await tool("set_net", { potId, percent: 20, reason: "Your side is the favourite; a net at 20% guards against a collapse." });
    await sleep(3000);
    await tool("request_exit", { potId, part: "full", reason: "Test over: leaving with the exit you signed in advance." });
    log(`pot is ${await waitState(["Divided"])}`);
    const dd = await api<{ agent: { sitter: { label: string } | null; actions: { action: string; reason: string | null }[]; proposals: { action: string; status: string }[] } }>(`/api/hc/pots/${potId}`);
    log(`pot page: minded by "${dd.agent.sitter?.label}", proposals ${dd.agent.proposals.map((p) => `${p.action}:${p.status}`).join(", ")}, actions ${dd.agent.actions.map((a) => a.action).join(", ")}`);
    if (!dd.agent.sitter || !dd.agent.proposals.some((p) => p.action === "set_net")) process.exitCode = 1;
    return;
  }
  await tool("list_my_pots", {});
  await tool("take_side", { potId, reason: "My player wants a game now; I take the other side of their $1 practice pot." });
  log(`pot is ${await waitState(["Live", "Open"])}`);
  await tool("set_net", { potId, percent: 15, reason: "A floor in case my side collapses before the game." });
  await sleep(4000);
  await tool("request_exit", { potId, part: "full", reason: "Test over: I leave at the 30-second average." });
  log(`pot is ${await waitState(["Divided"])}`);
  const detail = await api<{ agent: { opponent: { label: string } | null; actions: { action: string; reason: string | null }[] } }>(`/api/hc/pots/${potId}`);
  log(`pot page: played by "${detail.agent.opponent?.label}", ${detail.agent.actions.length} agent actions with reasons: ${detail.agent.actions.map((a) => a.action).join(", ")}`);
  if (!detail.agent.opponent || detail.agent.actions.filter((a) => a.reason).length < 3) process.exitCode = 1;
}

async function sweep() {
  const b = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [player.address] });
  if (b > 30_000n) await send(ARC_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [POOL, b - 30_000n] })).catch(() => {});
  log("leftovers back in the pool");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sweep().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
