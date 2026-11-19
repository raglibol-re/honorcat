import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { getConfig } from "../config";
import type { Db } from "../db";
import { memoCall } from "../memo";
import { sendRelayCalls } from "../txs";
import { CURRENT_HONOR } from "./config";

/**
 * The daily honor root (HonorRoots on Arc): a Merkle tree over every balance, leaves
 * (account, total honor in hundredths, rules version, day), the OpenZeppelin standard tree (sorted
 * pairs, double-hashed leaves), exactly what HonorRoots.leaf and verify use. The tree of each day is
 * kept, so anyone can get their proof for any posted day.
 */
export const LEAF_TYPES = ["address", "uint256", "uint32", "uint32"];

export const honorRootsAbi = [
  {
    type: "function",
    name: "post",
    stateMutability: "nonpayable",
    inputs: [
      { name: "day", type: "uint32" },
      { name: "root", type: "bytes32" },
      { name: "version", type: "uint32" },
      { name: "lastBlock", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "roots",
    stateMutability: "view",
    inputs: [{ name: "day", type: "uint32" }],
    outputs: [
      { name: "root", type: "bytes32" },
      { name: "version", type: "uint32" },
      { name: "lastBlock", type: "uint64" },
      { name: "postedAt", type: "uint64" },
    ],
  },
  { type: "function", name: "latestDay", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint32" }] },
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "total", type: "uint256" },
      { name: "day", type: "uint32" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** The contract's leaf, in TypeScript: keccak256(bytes.concat(keccak256(abi.encode(account, total, version, day)))). */
export function honorLeaf(account: Address, total: bigint, version: number, day: number): Hex {
  return keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint32" }, { type: "uint32" }], [account, total, version, day])));
}

export function buildHonorTree(balances: Record<string, number>, version: number, day: number) {
  const values = Object.entries(balances)
    .filter(([, p]) => p > 0)
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([a, p]) => [a, String(p), String(version), String(day)]);
  // a tree needs one leaf: an empty day gets the zero address with zero honor
  if (!values.length) values.push(["0x0000000000000000000000000000000000000000", "0", String(version), String(day)]);
  return StandardMerkleTree.of(values, LEAF_TYPES);
}

export const dayOf = (unixS: number) => Math.floor(unixS / 86_400);

/**
 * Once a day: builds today's tree from the stored balances, keeps it, and posts its root to
 * HonorRoots when the contract is deployed (a posted root can never be replaced).
 */
export async function postDailyRoot(db: Db) {
  const day = dayOf(Math.floor(Date.now() / 1000));
  const have = await db.query<{ tx: string | null }>("SELECT tx FROM honor_roots WHERE day = $1", [day]);
  if (have.length && have[0]!.tx) return { day, skipped: "posted" };
  const v = CURRENT_HONOR.version;
  if (!have.length) {
    const rows = await db.query<{ account: string; points: number }>("SELECT account, points FROM honor_balances WHERE version = $1", [v]);
    const state = (await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'honor_state'"))[0]?.value;
    const lastBlock = state ? Number((JSON.parse(state) as { lastBlock: number }).lastBlock) : 0;
    const tree = buildHonorTree(Object.fromEntries(rows.map((r) => [r.account, r.points])), v, day);
    await db.query("INSERT INTO honor_roots (day, version, root, last_block, tree) VALUES ($1, $2, $3, $4, $5)", [day, v, tree.root, lastBlock, JSON.stringify(tree.dump())]);
  }
  const at = getConfig().honorRoots;
  const stored = (await db.query<{ root: string; last_block: string }>("SELECT root, last_block::text AS last_block FROM honor_roots WHERE day = $1", [day]))[0]!;
  if (!at) return { day, root: stored.root, posted: false };
  const data = encodeFunctionData({ abi: honorRootsAbi, functionName: "post", args: [day, stored.root as Hex, v, BigInt(stored.last_block)] });
  const ref = `honor-${day}`;
  const res = await sendRelayCalls(db, "pot_house", [{ ...memoCall(at, data, ref, { v: 1, t: "record", ref, day }), potIds: [], label: `honor root ${day}` }]);
  if (res.ok) await db.query("UPDATE honor_roots SET tx = $2, posted_at = now() WHERE day = $1", [day, res.tx]);
  return { day, root: stored.root, posted: res.ok, tx: res.ok ? res.tx : null };
}

/** A player's proof for a day (default: the newest kept), with what a verifier needs. */
export async function honorProof(db: Db, account: string, day?: number) {
  const row = (
    await db.query<{ day: number; version: number; root: string; last_block: string; tree: unknown; tx: string | null }>(
      day === undefined
        ? "SELECT day, version, root, last_block::text AS last_block, tree, tx FROM honor_roots ORDER BY day DESC LIMIT 1"
        : "SELECT day, version, root, last_block::text AS last_block, tree, tx FROM honor_roots WHERE day = $1",
      day === undefined ? [] : [day],
    )
  )[0];
  if (!row) return null;
  const tree = StandardMerkleTree.load((typeof row.tree === "string" ? JSON.parse(row.tree) : row.tree) as Parameters<typeof StandardMerkleTree.load>[0]);
  const a = account.toLowerCase();
  const base = { day: row.day, version: row.version, root: row.root, lastBlock: Number(row.last_block), account: a, tx: row.tx, contract: getConfig().honorRoots };
  for (const [i, v] of tree.entries()) {
    if (String(v[0]).toLowerCase() === a) return { ...base, total: String(v[1]), proof: tree.getProof(i) };
  }
  return { ...base, total: "0", proof: null };
}

/** The newest root, for /how-it-is-built. */
export async function latestRoot(db: Db) {
  const r = (
    await db.query<{ day: number; version: number; root: string; last_block: string; tx: string | null }>(
      "SELECT day, version, root, last_block::text AS last_block, tx FROM honor_roots ORDER BY day DESC LIMIT 1",
    )
  )[0];
  return r ? { ...r, contract: getConfig().honorRoots } : null;
}
