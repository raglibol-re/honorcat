"use client";

import type { Address, Hex, TypedDataDefinition } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { PublicKey } from "@solana/web3.js";
import { deriveArcKey, solanaProvider } from "../solana";
import type { WalletAdapter } from "./types";

const TAB_KEY = "honorcat.solana-arc.v1";

/**
 * A Solana wallet (Phantom, Solflare) acting on Arc through the Arc account it derives by signing
 * one fixed message (see lib/solana.ts). Everything on Arc is gasless: this account only signs
 * (joins, the EIP-3009 funding authorization) and the relay submits. The derived key stays in this
 * tab's session storage; the wallet re-derives the same key on the next visit.
 */
export class SolanaWallet implements WalletAdapter {
  readonly id = "solana";
  readonly label = "Solana wallet";
  private account: PrivateKeyAccount | null = null;
  owner: PublicKey | null = null;
  private listeners = new Set<(a: Address | null) => void>();

  isAvailable() {
    return solanaProvider() !== null;
  }

  private restore() {
    if (this.account || typeof window === "undefined") return;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(TAB_KEY) ?? "null") as { key: Hex } | null;
      if (saved) this.account = privateKeyToAccount(saved.key);
    } catch {
      /* nothing saved */
    }
  }

  async getAccount(): Promise<Address | null> {
    this.restore();
    return this.account?.address ?? null;
  }

  async connect(): Promise<Address> {
    this.restore();
    const provider = solanaProvider();
    if (!provider) throw new Error("No Solana wallet found. Install Phantom or Solflare.");
    if (this.account && provider.publicKey) {
      this.owner = provider.publicKey;
      return this.account.address;
    }
    const { owner, key } = await deriveArcKey(provider);
    this.owner = owner;
    this.account = privateKeyToAccount(key);
    try {
      window.sessionStorage.setItem(TAB_KEY, JSON.stringify({ key }));
    } catch {
      /* the key lives in memory for this page */
    }
    for (const l of this.listeners) l(this.account.address);
    return this.account.address;
  }

  async send(): Promise<Hex> {
    throw new Error("This account is gasless: the relay sends its transactions.");
  }

  async signTypedData(data: TypedDataDefinition): Promise<Hex> {
    await this.connect();
    return this.account!.signTypedData(data as never);
  }

  async signMessage(message: string): Promise<Hex> {
    await this.connect();
    return this.account!.signMessage({ message });
  }

  async chainId() {
    return null;
  }

  onAccountChange(cb: (account: Address | null) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
}
