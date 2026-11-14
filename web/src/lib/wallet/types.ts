import type { Address, Hex } from "viem";

export type ContractCall = { to: Address; data: Hex };

/**
 * Everything the UI needs from "a wallet". The current implementation uses an injected
 * EIP-1193 provider (MetaMask, Rabby, ...). A wallet-less login (e.g. an embedded or
 * custodial signer) only has to implement this interface.
 */
export interface WalletAdapter {
  readonly id: string;
  readonly label: string;
  isAvailable(): boolean;
  /** Prompts the user if needed; returns the active account on Arc testnet. */
  connect(): Promise<Address>;
  /** Returns the account if already connected, without prompting. */
  getAccount(): Promise<Address | null>;
  /** Sends a transaction and resolves with its hash. */
  send(call: ContractCall): Promise<Hex>;
  onAccountChange(cb: (account: Address | null) => void): () => void;
}
