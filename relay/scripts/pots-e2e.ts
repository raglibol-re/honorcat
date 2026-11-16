/**
 * End-to-end run of a two-sided pot on Arc testnet against the deployed app (testnet USDC only).
 *
 *   create (gasless, EIP-3009) → join (gasless) → join window measured by the samplers → Live
 *   → exit request (signed, forwarded) → exit window → Divided (or held to settlement with --hold)
 *
 * Two throwaway wallets are funded from DEPLOYER_PRIVATE_KEY with a few testnet USDC. Samplers must
 * be running (the app's own, plus at least one more: `pnpm --filter @honorcat/relay sampler`).
 *
 * Scenarios after the pot is live (--scenario):
 *   exit       YES asks to leave (signed, forwarded); the exit window prices it; Divided
 *   handshake  both sign the same terms; divided at once, no fee
 *   takeover   YES asks to leave; a third wallet takes its place at the exit price; pot stays Live
 *   bowl       YES sets a bowl below the price (wallet pays its own gas); the samplers file the exit
 *   hold       stop once live (settlement happens later)
 *   together   two friends: a shared draft (host and guest agree the terms), then each puts in a side;
 *              the pot is never listed among the open offers
 *
 * Usage: tsx --env-file=../.env scripts/pots-e2e.ts [--scenario exit] [--api https://honorcat.vercel.app] [--notional 2] [--symbol GEMI-…]
 */
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, erc20Abi, http, keccak256, parseSignature, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC_USDC, usdcDomain } from "../src/arc";
import { receiveWithAuthorizationTypes } from "../src/gasless";
import { potsAbi } from "../src/potsAbi";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    api: { type: "string", default: "https://honorcat.vercel.app" },
    notional: { type: "string", default: "2" },
    symbol: { type: "string" },
    scenario: { type: "string", default: "exit" }, // exit | handshake | takeover | bowl | hold
  },
});
const API = values.api!.replace(/\/$/, "");
const rpc = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 400)}`);
  return JSON.parse(t) as T;
}

const createTuple = {
  type: "tuple",
  components: [
    { name: "conditionId", type: "bytes32" },
    { name: "resolver", type: "address" },
    { name: "side", type: "uint8" },
    { name: "notional", type: "uint256" },
    { name: "bandCenter", type: "uint32" },
    { name: "tolerance", type: "uint32" },
    { name: "closeTime", type: "uint64" },
    { name: "grace", type: "uint64" },
    { name: "window", type: "uint32" },
    { name: "minSamples", type: "uint32" },
  ],
} as const;

type Prepared = { conditionId: Hex; resolver: Address; pots: Address; chainId: number; closeTime: number; window: number; minSamples: number; depthId: string; cap: string; midPpm: number | null; market: { symbol: string; eventTitle: string; label: string } };

async function auth(owner: ReturnType<typeof privateKeyToAccount>, pots: Address, value: bigint, action: Hex) {
  const salt = keccak256(generatePrivateKey());
  const nonce = await client.readContract({ address: pots, abi: potsAbi, functionName: "depositNonce", args: [action, salt] });
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const domain = await usdcDomain(client as never, arcTestnet.id);
  const sig = await owner.signTypedData({ domain, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization", message: { from: owner.address, to: pots, value, validAfter: 0n, validBefore, nonce } });
  const { r, s, v } = parseSignature(sig);
  return { from: owner.address, validAfter: 0n, validBefore, salt, v: Number(v), r, s };
}

type Detail = { state: string; data: Record<string, string>; requests: { id: string; status: string; tx: string | null; error: string | null; payload: Record<string, unknown> }[] };

async function waitState(potId: string, want: string[], maxMs: number) {
  const end = Date.now() + maxMs;
  let last = "";
  for (;;) {
    const d = await api<Detail>(`/api/hc/pots/${potId}`);
    const line = `${d.state} | ${d.requests.slice(0, 2).map((r) => `${r.id}:${r.status}${r.error ? "(" + r.error.slice(0, 80) + ")" : ""}`).join(" ")}`;
    if (line !== last) log(`pot ${potId}: ${line}`);
    last = line;
    if (want.includes(d.state)) return d;
    if (Date.now() > end) throw new Error(`pot ${potId} still ${d.state} after ${maxMs / 1000}s`);
    await sleep(4000);
  }
}

const throwaway: ReturnType<typeof privateKeyToAccount>[] = [];
const fresh = () => {
  const a = privateKeyToAccount(generatePrivateKey());
  throwaway.push(a);
  return a;
};

/** Returns what is left in the throwaway wallets to the deployer (each pays its own small fee in USDC). */
async function sweep(to: Address) {
  for (const a of throwaway) {
    const w = createWalletClient({ account: a, chain: arcTestnet, transport: http(rpc) });
    const b = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [a.address] });
    const keep = 30_000n; // the transfer's own fee
    if (b <= keep) continue;
    try {
      const h = await w.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [to, b - keep] });
      await client.waitForTransactionReceipt({ hash: h });
      log(`swept ${Number(b - keep) / 1e6} USDC from ${a.address} back`);
    } catch (e) {
      log(`could not sweep ${a.address}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

async function main() {
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const wallet = createWalletClient({ account: deployer, chain: arcTestnet, transport: http(rpc) });
  const creator = fresh();
  const joiner = fresh();
  const notional = BigInt(Math.round(Number(values.notional) * 1e6));

  // 1. A market with enough depth for this notional.
  let symbol = values.symbol;
  if (!symbol) {
    const list = await api<{ items: { symbol: string; closeMs: number; book: { bid: number | null; ask: number | null; bidDepth: number; askDepth: number } | null; quality: { status: string } }[] }>(`/api/catalog?usable=1&limit=200`);
    const need = Number(notional) / 2500 / 100;
    const pick = list.items.find((x) => x.book && x.book.bid !== null && x.book.ask !== null && x.book.ask - x.book.bid <= 0.03 && x.book.bid >= 0.12 && x.book.ask <= 0.88 && Math.min(x.book.bidDepth, x.book.askDepth) >= need * 2 && x.closeMs - Date.now() > 2 * 3600_000);
    if (!pick) throw new Error("no market with enough depth right now");
    symbol = pick.symbol;
  }
  log(`market ${symbol}; creator ${creator.address}, joiner ${joiner.address}`);

  // 2. Fund both with testnet USDC (escrow is at most the notional).
  for (const w of [creator, joiner]) {
    const h = await wallet.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [w.address, notional + 500_000n] });
    await client.waitForTransactionReceipt({ hash: h });
  }
  log(`funded both with ${Number(notional + 500_000n) / 1e6} USDC`);

  // Together: the shared draft first (host = creator, guest = joiner), terms agreed through the API.
  const together = values.scenario === "together";
  let draftId = "";
  let hostToken = "";
  let guestToken = "";
  if (together) {
    const d = await api<{ id: string; token: string }>(`/api/hc/drafts`, { method: "POST", body: JSON.stringify({ account: creator.address, kind: "wallet" }) });
    draftId = d.id;
    hostToken = d.token;
    const sit = await api<{ token: string }>(`/api/hc/drafts/${draftId}`, { method: "POST", body: JSON.stringify({ action: "sit", account: joiner.address, kind: "wallet" }) });
    guestToken = sit.token;
    const t = await api<{ draft: { version: number } }>(`/api/hc/drafts/${draftId}`, {
      method: "POST",
      body: JSON.stringify({ action: "terms", token: hostToken, symbol, label: "e2e", notional: notional.toString(), hostSide: 0 }),
    });
    await api(`/api/hc/drafts/${draftId}`, { method: "POST", body: JSON.stringify({ action: "agree", token: guestToken, version: t.draft.version }) });
    log(`draft ${draftId}: guest sat down and agreed to version ${t.draft.version}`);
  }

  // 3. Prepare: rule, conditionId, close, depth attestation (2-of-3).
  const prep = await api<Prepared>(`/api/hc/prepare`, { method: "POST", body: JSON.stringify({ symbol, account: creator.address }) });
  log(`prepared ${prep.market.eventTitle} / ${prep.market.label}: cap ${Number(prep.cap) / 1e6} USDC, mid ${prep.midPpm}`);
  if (BigInt(prep.cap) < notional) throw new Error("cap below notional");
  let depth: { depth: { conditionId: Hex; account: Address; contracts5c: string; closeTime: string; validUntil: string }; signatures: Hex | null } | null = null;
  for (let i = 0; i < 30; i++) {
    depth = await api(`/api/hc/depth?id=${encodeURIComponent(prep.depthId)}`);
    if (depth!.signatures) break;
    await sleep(2000);
  }
  if (!depth?.signatures) throw new Error("depth attestation was not co-signed (is a second sampler running?)");
  log("depth attestation co-signed");

  // 4. Create (YES), gasless.
  const c = { conditionId: prep.conditionId, resolver: prep.resolver, side: 0, notional, bandCenter: prep.midPpm!, tolerance: 50_000, closeTime: BigInt(prep.closeTime), grace: 86_400n, window: prep.window, minSamples: prep.minSamples };
  const escrow = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "worstCase", args: [0, notional, c.bandCenter, c.tolerance] });
  const createAction = keccak256(encodeAbiParameters([{ type: "string" }, { type: "address" }, createTuple], ["create", creator.address, c]));
  const d = depth.depth;
  const createData = encodeFunctionData({
    abi: potsAbi,
    functionName: "create",
    args: [c, { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) }, depth.signatures, await auth(creator, prep.pots, escrow, createAction)],
  });
  const created = await api<{ tx: Hex; potId: string | null }>(`/api/hc/forward`, { method: "POST", body: JSON.stringify({ data: createData }) });
  const list = await api<{ pots: { potId: string; owners: { yes: string | null } }[] }>(`/api/hc/pots?owner=${creator.address}`);
  const potId = created.potId ?? list.pots[0]?.potId;
  if (!potId) throw new Error("created, but the pot is not indexed");
  log(`created pot ${potId} (tx ${created.tx}), escrow ${Number(escrow) / 1e6}`);
  if (together) {
    await api(`/api/hc/drafts/${draftId}`, { method: "POST", body: JSON.stringify({ action: "created", token: hostToken, potId }) });
    const offers = await api<{ pots: { potId: string }[] }>(`/api/hc/pots?state=open&limit=200`);
    const listed = offers.pots.some((x) => x.potId === potId);
    log(`draft ${draftId} linked to pot ${potId}; listed among open offers: ${listed}`);
    if (listed) throw new Error("a pot started together must not be offered to others");
  }

  // 5. Join (NO), gasless; the entry price is the window average after this request.
  const pot = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "pot", args: [BigInt(potId)] });
  const nonce = BigInt((pot as unknown as { nonce: bigint }).nonce) + 1n;
  const joinEscrow = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "worstCase", args: [1, notional, c.bandCenter, c.tolerance] });
  const joinAction = keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint64" }], ["join", BigInt(potId), joiner.address, nonce]));
  const joinData = encodeFunctionData({ abi: potsAbi, functionName: "requestJoin", args: [BigInt(potId), await auth(joiner, prep.pots, joinEscrow, joinAction)] });
  const joined = await api<{ tx: Hex }>(`/api/hc/forward`, { method: "POST", body: JSON.stringify({ data: joinData }) });
  log(`join requested (tx ${joined.tx}); waiting for the window`);
  const live = await waitState(potId, ["Live", "Open"], 6 * 60_000);
  if (live.state !== "Live") throw new Error(`join failed: ${JSON.stringify(live.requests[0]?.payload?.reason)}`);
  const jr = live.requests.find((r) => r.id.endsWith(":0"));
  log(`LIVE: entry ${JSON.stringify((jr?.payload?.attestation as { priceYes?: number })?.priceYes)} ppm (${String(jr?.payload?.reason)}), deposits YES ${Number(live.data.depYes) / 1e6} NO ${Number(live.data.depNo) / 1e6}`);
  const scenario = values.scenario!;
  if (together) {
    const d = await api<{ status: string }>(`/api/hc/drafts/${draftId}`);
    log(`draft ${draftId}: ${d.status}`);
    if (d.status !== "joined") process.exitCode = 1;
    return;
  }
  if (scenario === "hold") return;
  const id = BigInt(potId);
  const balances = async (who: [string, { address: Address }][]) => {
    for (const [n, w] of who) {
      const b = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [w.address] });
      log(`${n} balance ${Number(b) / 1e6} USDC`);
    }
  };
  const exitRequest = async () => {
    await sleep(3000);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const digest = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "exitRequestDigest", args: [id, 0, notional, deadline] });
    const sig = await creator.sign({ hash: digest });
    const exitData = encodeFunctionData({ abi: potsAbi, functionName: "requestExitFor", args: [id, 0, notional, deadline, sig] });
    const ex = await api<{ tx: Hex }>(`/api/hc/forward`, { method: "POST", body: JSON.stringify({ data: exitData }) });
    log(`exit requested (tx ${ex.tx})`);
  };

  if (scenario === "exit") {
    await exitRequest();
    const end = await waitState(potId, ["Divided", "Live"], 6 * 60_000);
    const er = end.requests.find((r) => r.id.endsWith(":1"));
    log(`${end.state}: ${String(er?.payload?.reason)} tx ${er?.tx}`);
    await balances([["creator", creator], ["joiner", joiner]]);
    if (end.state !== "Divided") process.exitCode = 1;
    return;
  }

  if (scenario === "handshake") {
    const priceYes = 700_000; // both agree on 70% YES
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const potNow = (await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "pot", args: [id] })) as unknown as { nonce: bigint };
    const domain = { name: "HonorCatPots", version: "1", chainId: arcTestnet.id, verifyingContract: prep.pots } as const;
    const types = {
      Handshake: [
        { name: "potId", type: "uint256" },
        { name: "priceYes", type: "uint32" },
        { name: "notional", type: "uint256" },
        { name: "potNonce", type: "uint64" },
        { name: "deadline", type: "uint256" },
      ],
    } as const;
    const message = { potId: id, priceYes, notional, potNonce: potNow.nonce, deadline };
    for (const [side, w] of [[0, creator], [1, joiner]] as const) {
      const signature = await w.signTypedData({ domain, types, primaryType: "Handshake", message });
      const r = await api<{ submitted: boolean; tx?: Hex }>(`/api/hc/pots/${potId}/handshake`, {
        method: "POST",
        body: JSON.stringify({ side, priceYes, notional: notional.toString(), deadline: Number(deadline), signature }),
      });
      log(`${side === 0 ? "YES" : "NO"} signed the handshake: ${r.submitted ? `submitted, tx ${r.tx}` : "waiting for the other side"}`);
    }
    const end = await waitState(potId, ["Divided"], 60_000);
    log(`${end.state} by handshake at 70% YES, no fee`);
    await balances([["creator", creator], ["joiner", joiner]]);
    return;
  }

  if (scenario === "takeover") {
    const taker = fresh();
    const h = await wallet.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: "transfer", args: [taker.address, notional + 200_000n] });
    await client.waitForTransactionReceipt({ hash: h });
    log(`taker ${taker.address} funded`);
    await exitRequest();
    const pr = (await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "pot", args: [id] })) as unknown as { nonce: bigint };
    const action = keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint64" }], ["takeover", id, taker.address, pr.nonce]));
    const data = encodeFunctionData({ abi: potsAbi, functionName: "takeover", args: [id, await auth(taker, prep.pots, notional, action)] });
    const t = await api<{ tx: Hex }>(`/api/hc/forward`, { method: "POST", body: JSON.stringify({ data }) });
    log(`takeover offered (tx ${t.tx}); waiting for the exit window`);
    await sleep(5000);
    const end = await waitState(potId, ["Live", "Divided"], 6 * 60_000);
    const yesOwner = await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "ownerOf", args: [id * 2n] });
    log(`${end.state}; YES is now held by ${yesOwner} (${String(yesOwner).toLowerCase() === taker.address.toLowerCase() ? "the taker" : "not the taker"})`);
    await balances([["creator", creator], ["joiner", joiner], ["taker", taker]]);
    if (String(yesOwner).toLowerCase() !== taker.address.toLowerCase()) process.exitCode = 1;
    return;
  }

  if (scenario === "bowl") {
    // YES's own price is the YES price; a bowl below it is reached at once and holds.
    const live2 = (await client.readContract({ address: prep.pots, abi: potsAbi, functionName: "pot", args: [id] })) as unknown as { notional: bigint };
    const bowl = Math.max(10_000, (prep.midPpm ?? 500_000) - 100_000);
    const cw = createWalletClient({ account: creator, chain: arcTestnet, transport: http(rpc) });
    const tx = await cw.writeContract({ address: prep.pots, abi: potsAbi, functionName: "setLevels", args: [id, 0, 0, bowl] });
    await client.waitForTransactionReceipt({ hash: tx });
    await api(`/api/hc/pots/${potId}`, { method: "POST" });
    log(`YES set a bowl at ${(bowl / 10_000).toFixed(1)}% (tx ${tx}); the samplers watch for a full window above it (notional ${Number(live2.notional) / 1e6})`);
    const filed = await waitState(potId, ["ExitRequested", "Divided"], 6 * 60_000);
    log(`${filed.state}: the bowl filed the exit`);
    const end = await waitState(potId, ["Divided", "Live"], 6 * 60_000);
    log(`${end.state}`);
    await balances([["creator", creator], ["joiner", joiner]]);
    if (end.state !== "Divided") process.exitCode = 1;
    return;
  }
  throw new Error(`unknown scenario ${scenario}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sweep(privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex).address).catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
