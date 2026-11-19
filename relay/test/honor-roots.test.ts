import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { describe, expect, it } from "vitest";
import { concat, keccak256, type Address } from "viem";
import { buildHonorTree, honorLeaf, LEAF_TYPES } from "../src/honor/roots";

const alice = "0x00000000000000000000000000000000000a11ce" as Address;
const bob = "0x0000000000000000000000000000000000000b0b" as Address;

describe("honor roots", () => {
  it("builds the tree HonorRoots verifies: the same leaf and sorted-pair hashing as the contract", () => {
    const tree = buildHonorTree({ [alice]: 2450, [bob]: 1000 }, 1, 20412);
    const la = honorLeaf(alice, 2450n, 1, 20412);
    const lb = honorLeaf(bob, 1000n, 1, 20412);
    const pair = la < lb ? keccak256(concat([la, lb])) : keccak256(concat([lb, la]));
    expect(tree.root).toBe(pair);
    for (const [i, v] of tree.entries()) {
      const proof = tree.getProof(i);
      expect(StandardMerkleTree.verify(tree.root, LEAF_TYPES, v, proof)).toBe(true);
      // a changed balance fails
      expect(StandardMerkleTree.verify(tree.root, LEAF_TYPES, [v[0], String(Number(v[1]) + 1), v[2], v[3]], proof)).toBe(false);
    }
  });

  it("is the same tree for the same balances, whatever their order; an empty day has one zero leaf", () => {
    const a = buildHonorTree({ [alice]: 5, [bob]: 7 }, 1, 1);
    const b = buildHonorTree({ [bob]: 7, [alice]: 5 }, 1, 1);
    expect(a.root).toBe(b.root);
    expect([...buildHonorTree({}, 1, 1).entries()].length).toBe(1);
  });
});
