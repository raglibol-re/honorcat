"use client";

import type { Address, Hex, TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { ContractCall, WalletAdapter } from "./types";

const STORAGE_KEY = "verdict.device-account.v1";

/**
 * Temporary wallet-less account for customers until passkey accounts exist: a key generated in
 * the browser and kept in this device's storage. It only signs; the relay submits everything and
 * pays gas (EIP-3009 for withdrawals), so the account never needs a gas balance.
 *
 * Trade-off, stated in the UI: clearing site data loses the key. A passkey-backed account can
 * replace this adapter without changing the pages, since they only use WalletAdapter.
 */
export class DeviceWallet implements WalletAdapter {
  readonly id = "device";
  readonly label = "This device";
  private account: PrivateKeyAccount | null = null;

  isAvailable() {
    return typeof window !== "undefined";
  }

  private load(create: boolean): PrivateKeyAccount | null {
    if (this.account) return this.account;
    let key: string | null = null;
    try {
      key = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      key = null;
    }
    if (!key && create) {
      key = generatePrivateKey();
      try {
        window.localStorage.setItem(STORAGE_KEY, key);
      } catch {
        /* private mode: the account lives for this tab only */
      }
    }
    this.account = key ? privateKeyToAccount(key as Hex) : null;
    return this.account;
  }

  async getAccount(): Promise<Address | null> {
    return this.load(false)?.address ?? null;
  }

  async connect(): Promise<Address> {
    return this.load(true)!.address;
  }

  async send(call: ContractCall): Promise<Hex> {
    void call;
    throw new Error("This account does not send transactions; the relay submits for you.");
  }

  async signTypedData(data: TypedDataDefinition): Promise<Hex> {
    return this.load(true)!.signTypedData(data as never);
  }

  async signMessage(message: string): Promise<Hex> {
    return this.load(true)!.signMessage({ message });
  }

  onAccountChange(): () => void {
    return () => {};
  }
}

let shared: DeviceWallet | null = null;
export function deviceWallet(): DeviceWallet {
  shared ??= new DeviceWallet();
  return shared;
}
