import { getAddress, type Address } from "viem";

/** The message a funder or recipient signs to see a payout's raw evidence (server checks it). */
export const evidenceMessage = (id: string, account: Address, issuedAt: string) =>
  `HonorCat: show me the raw market readings of payout ${id}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;
