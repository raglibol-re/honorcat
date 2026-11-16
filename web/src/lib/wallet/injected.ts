import { createPublicClient, createWalletClient, custom, http, numberToHex, type Address, type Chain, type EIP1193Provider, type Hex, type TypedDataDefinition } from "viem";
import { arcTestnet } from "viem/chains";
import { RPC_URL } from "../chain";
import { chosenProvider } from "./eip6963";
import type { ContractCall, WalletAdapter } from "./types";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

/**
 * Browser-extension wallet via EIP-1193. Which wallet: the one the user picked among those that
 * announced themselves (EIP-6963), else the only one, else the legacy window.ethereum.
 */
export class InjectedWallet implements WalletAdapter {
  readonly id = "injected";

  get label() {
    return chosenProvider()?.name ?? "Browser wallet";
  }

  private get provider(): EIP1193Provider {
    const p = chosenProvider();
    if (!p) throw new Error("No browser wallet found");
    return p.provider;
  }

  isAvailable() {
    return chosenProvider() !== null;
  }

  async getAccount(): Promise<Address | null> {
    if (!this.isAvailable()) return null;
    const accounts = (await this.provider.request({ method: "eth_accounts" })) as Address[];
    return accounts[0] ?? null;
  }

  async connect(): Promise<Address> {
    const accounts = (await this.provider.request({ method: "eth_requestAccounts" })) as Address[];
    if (!accounts[0]) throw new Error("No account authorised");
    return accounts[0];
  }

  async chainId(): Promise<number | null> {
    if (!this.isAvailable()) return null;
    return Number(await this.provider.request({ method: "eth_chainId" }));
  }

  /** Switches to `chain`, adding it to the wallet first if the wallet does not know it. */
  private async ensureChain(chain: Chain = arcTestnet) {
    if ((await this.chainId()) === chain.id) return;
    const chainIdHex = numberToHex(chain.id);
    try {
      await this.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err) {
      if ((err as { code?: number }).code !== 4902) throw err;
      await this.provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: chain.name,
            // Arc's native gas token is USDC with 18 decimals on the native interface.
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [chain.id === arcTestnet.id ? RPC_URL : chain.rpcUrls.default.http[0]!],
            blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
          },
        ],
      });
    }
  }

  async send(call: ContractCall) {
    const account = await this.connect();
    await this.ensureChain();
    const client = createWalletClient({ account, chain: arcTestnet, transport: custom(this.provider) });
    return client.sendTransaction({ to: call.to, data: call.data });
  }

  async signTypedData(data: TypedDataDefinition) {
    const account = await this.connect();
    // MetaMask refuses typed data whose domain chain differs from the active chain.
    await this.ensureChain();
    const client = createWalletClient({ account, chain: arcTestnet, transport: custom(this.provider) });
    return client.signTypedData({ account, ...data } as never);
  }

  async signMessage(message: string): Promise<Hex> {
    const account = await this.connect();
    const client = createWalletClient({ account, transport: custom(this.provider) });
    return client.signMessage({ account, message });
  }

  async sendOn(chain: Chain, call: ContractCall): Promise<Hex> {
    const account = await this.connect();
    await this.ensureChain(chain);
    const client = createWalletClient({ account, chain, transport: custom(this.provider) });
    const hash = await client.sendTransaction({ to: call.to, data: call.data });
    await createPublicClient({ chain, transport: http() }).waitForTransactionReceipt({ hash, timeout: 180_000 });
    return hash;
  }

  onAccountChange(cb: (account: Address | null) => void) {
    if (!this.isAvailable()) return () => {};
    const handler = (accounts: Address[]) => cb(accounts[0] ?? null);
    this.provider.on("accountsChanged", handler as never);
    return () => this.provider.removeListener("accountsChanged", handler as never);
  }
}
