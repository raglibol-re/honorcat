import type { Address, Hex, LocalAccount } from "viem";

export const resolutionTypes = {
  Resolution: [
    { name: "potId", type: "uint256" },
    { name: "conditionId", type: "bytes32" },
    { name: "outcome", type: "bool" },
  ],
} as const;

export function resolutionDomain(chainId: number, vault: Address) {
  return { name: "VerdictVault", version: "1", chainId, verifyingContract: vault } as const;
}

/** EIP-712 signature accepted by VerdictVault.resolve. Bound to chain, contract, pot and condition. */
export function signResolution(
  account: LocalAccount,
  args: { chainId: number; vault: Address; potId: bigint; conditionId: Hex; outcome: boolean },
): Promise<Hex> {
  return account.signTypedData({
    domain: resolutionDomain(args.chainId, args.vault),
    types: resolutionTypes,
    primaryType: "Resolution",
    message: { potId: args.potId, conditionId: args.conditionId, outcome: args.outcome },
  });
}
