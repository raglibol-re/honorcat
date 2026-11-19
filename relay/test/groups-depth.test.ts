import { describe, expect, it } from "vitest";
import { hashTypedData, type Address, type Hex } from "viem";
import { depthDigest } from "../src/pots";

const GROUPS = "0xDe28a5d9E328c09eb02A099f1480DE89E0FEb547" as Address;
const d = { conditionId: `0x${"ab".repeat(32)}` as Hex, account: "0x3Bdf45f81944c4Ad742a4f124980Dec40A812a40" as Address, contracts5c: "645900", spread: 10000, crypto: false, closeTime: "1795302000", validUntil: "1795104578" };

describe("a group's depth attestation is hashed as the group contract does", () => {
  it("uses the v2 layout (spread, crypto) under the HonorCatGroups domain", () => {
    const want = hashTypedData({
      domain: { name: "HonorCatGroups", version: "1", chainId: 5042002, verifyingContract: GROUPS },
      types: { Depth: [{ name: "conditionId", type: "bytes32" }, { name: "account", type: "address" }, { name: "contracts5c", type: "uint64" }, { name: "spread", type: "uint32" }, { name: "crypto", type: "bool" }, { name: "closeTime", type: "uint64" }, { name: "validUntil", type: "uint64" }] },
      primaryType: "Depth",
      message: { conditionId: d.conditionId, account: d.account, contracts5c: 645900n, spread: 10000, crypto: false, closeTime: 1795302000n, validUntil: 1795104578n },
    });
    expect(depthDigest(d as never, { chainId: 5042002, pots: GROUPS, name: "HonorCatGroups" })).toBe(want);
  });
});
