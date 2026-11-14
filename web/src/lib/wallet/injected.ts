import { createWalletClient, custom, numberToHex, type Address, type EIP1193Provider, type TypedDataDefinition } from "viem";
import { arcTestnet } from "viem/chains";
import { RPC_URL } from "../chain";
import type { ContractCall, WalletAdapter } from "./types";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

/** Browser-extension wallet via EIP-1193 (window.ethereum). */
export class InjectedWallet implements WalletAdapter {
  readonly id = "injected";
  readonly label = "Browser wallet";

  private get provider(): EIP1193Provider {
    if (typeof window === "undefined" || !window.ethereum) throw new Error("No browser wallet found");
    return window.ethereum;
  }

  isAvailable() {
    return typeof window !== "undefined" && Boolean(window.ethereum);
  }

  async getAccount(): Promise<Address | null> {
    if (!this.isAvailable()) return null;
    const accounts = (await this.provider.request({ method: "eth_accounts" })) as Address[];
    return accounts[0] ?? null;
  }

  async connect(): Promise<Address> {
    const accounts = (await this.provider.request({ method: "eth_requestAccounts" })) as Address[];
    if (!accounts[0]) throw new Error("No account authorised");
    await this.ensureChain();
    return accounts[0];
  }

  private async ensureChain() {
    const chainIdHex = numberToHex(arcTestnet.id);
    try {
      await this.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err) {
      if ((err as { code?: number }).code !== 4902) throw err;
      await this.provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: arcTestnet.name,
            // Arc's native gas token is USDC with 18 decimals on the native interface.
            nativeCurrency: arcTestnet.nativeCurrency,
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [arcTestnet.blockExplorers.default.url],
          },
        ],
      });
    }
  }

  async send(call: ContractCall) {
    const account = await this.connect();
    const client = createWalletClient({ account, chain: arcTestnet, transport: custom(this.provider) });
    return client.sendTransaction({ to: call.to, data: call.data });
  }

  async signTypedData(data: TypedDataDefinition) {
    const account = await this.connect();
    const client = createWalletClient({ account, chain: arcTestnet, transport: custom(this.provider) });
    return client.signTypedData({ account, ...data } as never);
  }

  onAccountChange(cb: (account: Address | null) => void) {
    if (!this.isAvailable()) return () => {};
    const handler = (accounts: Address[]) => cb(accounts[0] ?? null);
    this.provider.on("accountsChanged", handler as never);
    return () => this.provider.removeListener("accountsChanged", handler as never);
  }
}
