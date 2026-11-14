import { describe, expect, it } from "vitest";
import { concat, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { buildDropTree } from "../src/drops";
import { memoryDb } from "../src/db";
import { applyMerkleEvent } from "../src/drops";

const acct = (i: number) => `0x${(0xa0000 + i).toString(16).padStart(40, "0")}` as Address;

/** Exactly what MerkleBook.claim computes on-chain. */
const leaf = (i: bigint, a: Address, amt: bigint) =>
  keccak256(concat([keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [i, a, amt]))]));

/** OpenZeppelin MerkleProof.processProof with commutative keccak. */
function processProof(proof: Hex[], l: Hex): Hex {
  return proof.reduce((h, p) => (BigInt(h) < BigInt(p) ? keccak256(concat([h, p])) : keccak256(concat([p, h]))), l);
}

describe("drop trees", () => {
  it("every proof verifies against the root with the contract's leaf encoding", () => {
    const entries = Array.from({ length: 257 }, (_, i) => ({ account: acct(i), amount: BigInt(1_000_000 + i) }));
    const { tree, root, total } = buildDropTree(entries);
    expect(total).toBe(entries.reduce((s, e) => s + e.amount, 0n));
    for (const [i, v] of tree.entries()) {
      const l = leaf(BigInt(v[0]), v[1] as Address, BigInt(v[2]));
      expect(processProof(tree.getProof(i) as Hex[], l)).toBe(root);
    }
  });

  it("a proof does not verify for another amount or account", () => {
    const { tree, root } = buildDropTree([0, 1, 2, 3].map((i) => ({ account: acct(i), amount: 5n })));
    const p = tree.getProof(0) as Hex[];
    const [i, a] = tree.at(0)!;
    expect(processProof(p, leaf(BigInt(i), a as Address, 6n))).not.toBe(root);
    expect(processProof(p, leaf(BigInt(i), acct(9), 5n))).not.toBe(root);
  });

  it("rejects empty lists, bad addresses and non-positive amounts", () => {
    expect(() => buildDropTree([])).toThrow(/empty/);
    expect(() => buildDropTree([{ account: "0x1234" as Address, amount: 1n }])).toThrow(/address/);
    expect(() => buildDropTree([{ account: acct(1), amount: 0n }])).toThrow(/positive/);
  });

  it("indexed Claimed / ClaimDeferred events mark entries", async () => {
    const db = await memoryDb();
    await db.query(
      `INSERT INTO drops (id, drop_id, name, funder, condition_key, condition_label, condition_id, lock_time, deadline, claim_deadline, root, root_total, entries)
       VALUES ('d1', 7, 'x', '0x0', 'E:C', 'l', '0x', 1, 2, 3, '0x', 10, 2)`,
    );
    await db.query(`INSERT INTO drop_entries (drop_id, idx, account, amount, proof, version) VALUES ('d1', 0, 'a', 5, '[]', 1), ('d1', 1, 'b', 5, '[]', 1)`);
    await applyMerkleEvent(db, "Claimed", { dropId: "7", index: "0" }, "0xaa");
    await applyMerkleEvent(db, "ClaimDeferred", { dropId: "7", index: "1" }, "0xbb");
    const rows = await db.query<{ idx: number; claimed_tx: string; deferred: boolean }>("SELECT idx, claimed_tx, deferred FROM drop_entries ORDER BY idx");
    expect(rows).toEqual([
      { idx: 0, claimed_tx: "0xaa", deferred: false },
      { idx: 1, claimed_tx: "0xbb", deferred: true },
    ]);
  });
});
