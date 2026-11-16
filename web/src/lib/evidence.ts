import { getAddress, type Address } from "viem";

/** The message a funder or recipient signs to see a payout's raw evidence (server checks it). */
export const evidenceMessage = (id: string, account: Address, issuedAt: string) =>
  `HonorCat: show me the raw market readings of payout ${id}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

/** The message a side signs to see a pot's raw evidence (server checks it). */
export const potEvidenceMessage = (potId: string, account: Address, issuedAt: string) =>
  `HonorCat: show me the raw market readings of pot ${potId}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

/** The Sign-In with Ethereum (EIP-4361) statement for a pot's raw readings. */
export const potEvidenceStatement = (potId: string) => `Show me the raw market readings of HonorCat pot ${potId}.`;
