import type { Address, Chain, Hex, TypedDataDefinition } from "viem";

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
  /** Prompts the user if needed; returns the active account (any chain; Arc actions switch to Arc). */
  connect(): Promise<Address>;
  /** Returns the account if already connected, without prompting. */
  getAccount(): Promise<Address | null>;
  /** Sends a transaction and resolves with its hash. */
  send(call: ContractCall): Promise<Hex>;
  /**
   * Signs EIP-712 typed data (eth_signTypedData_v4). Used for gasless funding: the user signs
   * an Arc USDC `ReceiveWithAuthorization` and the relay submits it, so no gas is needed.
   */
  signTypedData(data: TypedDataDefinition): Promise<Hex>;
  onAccountChange(cb: (account: Address | null) => void): () => void;
  /** Signs a plain text message (EIP-191). Chain-independent: used to join with a wallet. */
  signMessage?(message: string): Promise<Hex>;
  /** The chain the wallet is on right now (EVM chain id). */
  chainId?(): Promise<number | null>;
  /** Switches the wallet to `chain` (adding it if needed), sends there and waits for the receipt. */
  sendOn?(chain: Chain, call: ContractCall): Promise<Hex>;
}
