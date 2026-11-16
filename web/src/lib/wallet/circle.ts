"use client";

import type { Address, Hex, TypedDataDefinition } from "viem";
import type { ContractCall, WalletAdapter } from "./types";

/**
 * A Circle smart account (Circle Modular Wallets, MSCA) owned by a passkey, on Arc testnet. Every
 * action is a user operation that Circle's paymaster sponsors on testnet, so the player never needs
 * gas, and an approval plus the pot action go in one user operation. The account address is
 * deterministic; it is deployed with its first user operation. Signatures verify through ERC-1271
 * (ERC-6492 before deployment). Docs: developers.circle.com/wallets/modular/create-a-modular-wallet
 */
const CLIENT_URL = "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";
const KEY = "honorcat.circle.credential";
type Stored = { id: string; publicKey: Hex; rpId?: string };

// The SDK pins its own viem; its objects are passed through as they are.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Session = { account: any; bundler: any; address: Address };

export class CircleWallet implements WalletAdapter {
  readonly id = "circle";
  readonly label = "Circle smart account";
  /** "register" creates a new passkey; "login" uses one this person already has. */
  mode: "register" | "login" = "login";
  username = "";
  private session: Session | null = null;
  private listeners = new Set<(a: Address | null) => void>();

  static clientKey() {
    return process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? "";
  }
  /** Shown only once the passkey domain is set in Circle's console (NEXT_PUBLIC_CIRCLE_MODULAR_READY=1). */
  isAvailable() {
    return typeof window !== "undefined" && !!window.PublicKeyCredential && !!CircleWallet.clientKey() && process.env.NEXT_PUBLIC_CIRCLE_MODULAR_READY === "1";
  }

  private async build(credential: Stored): Promise<Session> {
    const [{ toModularTransport, toCircleSmartAccount }, { createPublicClient }, { createBundlerClient, toWebAuthnAccount }, { arcTestnet }] = await Promise.all([
      import("@circle-fin/modular-wallets-core"),
      import("viem"),
      import("viem/account-abstraction"),
      import("viem/chains"),
    ]);
    const transport = toModularTransport(`${CLIENT_URL}/arcTestnet`, CircleWallet.clientKey());
    const client = createPublicClient({ chain: arcTestnet, transport: transport as any });
    const owner = toWebAuthnAccount({ credential: credential as any });
    const account = await toCircleSmartAccount({ client: client as any, owner: owner as any, name: "HonorCat" } as any);
    const bundler = createBundlerClient({ account: account as any, chain: arcTestnet, transport: transport as any });
    return { account, bundler, address: account.address as Address };
  }

  async connect(): Promise<Address> {
    if (!CircleWallet.clientKey()) throw new Error("Circle smart accounts are not set up on this site yet.");
    const { toPasskeyTransport, toWebAuthnCredential, WebAuthnMode } = await import("@circle-fin/modular-wallets-core");
    const passkeys = toPasskeyTransport(CLIENT_URL, CircleWallet.clientKey());
    const cred = (await toWebAuthnCredential({
      transport: passkeys,
      mode: this.mode === "register" ? WebAuthnMode.Register : WebAuthnMode.Login,
      ...(this.mode === "register" ? { username: this.username || `honorcat-${Date.now().toString(36)}` } : {}),
    } as any)) as { id: string; publicKey: Hex; rpId?: string };
    const stored: Stored = { id: cred.id, publicKey: cred.publicKey, rpId: cred.rpId };
    try {
      localStorage.setItem(KEY, JSON.stringify(stored));
    } catch {
      /* private mode: this tab only */
    }
    this.session = await this.build(stored);
    this.emit(this.session.address);
    return this.session.address;
  }

  async getAccount(): Promise<Address | null> {
    if (this.session) return this.session.address;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw || !CircleWallet.clientKey()) return null;
      this.session = await this.build(JSON.parse(raw) as Stored);
      return this.session.address;
    } catch {
      return null;
    }
  }

  forget() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing stored */
    }
    this.session = null;
    this.emit(null);
  }

  private async need(): Promise<Session> {
    if (!this.session) await this.getAccount();
    if (!this.session) throw new Error("Sign in with your Circle passkey first.");
    return this.session;
  }

  /** Several calls in one user operation, gas sponsored by Circle's paymaster; resolves with the transaction hash. */
  async sendBatch(calls: ContractCall[]): Promise<Hex> {
    const s = await this.need();
    const hash = await s.bundler.sendUserOperation({ calls: calls.map((c) => ({ to: c.to, data: c.data })), paymaster: true });
    const { receipt } = await s.bundler.waitForUserOperationReceipt({ hash, timeout: 90_000 });
    return receipt.transactionHash as Hex;
  }

  send(call: ContractCall): Promise<Hex> {
    return this.sendBatch([call]);
  }

  async signMessage(message: string): Promise<Hex> {
    const s = await this.need();
    return s.account.signMessage({ message }) as Promise<Hex>;
  }

  async signTypedData(data: TypedDataDefinition): Promise<Hex> {
    const s = await this.need();
    return s.account.signTypedData(data) as Promise<Hex>;
  }

  onAccountChange(cb: (account: Address | null) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  private emit(a: Address | null) {
    for (const cb of this.listeners) cb(a);
  }
  async chainId() {
    return 5042002;
  }
}
