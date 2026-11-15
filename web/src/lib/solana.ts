/**
 * Paying from Solana Devnet with Circle CCTP V2.
 *
 * The burn is the TokenMessengerMinterV2 `deposit_for_burn` instruction, built by hand from
 * Circle's IDL (circlefin/solana-cctp-contracts, examples/target/idl/token_messenger_minter_v2.json):
 * discriminator, then DepositForBurnParams { amount u64, destination_domain u32, mint_recipient
 * pubkey, destination_caller pubkey, max_fee u64, min_finality_threshold u32 }, little endian.
 * Account order is the IDL's. PDAs checked against devnet on 2026-11-15.
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { ARC_DOMAIN, FAST, SOLANA_DOMAIN } from "./cctp";

export { SOLANA_DOMAIN };

export const SOLANA_RPC = "https://api.devnet.solana.com";
export const TMM = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
export const MT = new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
export const SOLANA_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const DEPOSIT_FOR_BURN = Uint8Array.from([215, 60, 61, 46, 114, 55, 128, 176]);

const enc = new TextEncoder();
const pda = (seeds: (string | Uint8Array)[], program: PublicKey) =>
  PublicKey.findProgramAddressSync(
    seeds.map((s) => (typeof s === "string" ? enc.encode(s) : s)),
    program,
  )[0];

export const connection = () => new Connection(SOLANA_RPC, "confirmed");

export function usdcAccount(owner: PublicKey): PublicKey {
  return pda([owner.toBytes(), TOKEN_PROGRAM.toBytes(), SOLANA_USDC.toBytes()], ATA_PROGRAM);
}

/** Devnet USDC of `owner` in base units (6 decimals); 0 when the token account does not exist. */
export async function solanaUsdc(owner: PublicKey): Promise<bigint> {
  const r = await connection()
    .getTokenAccountBalance(usdcAccount(owner))
    .catch(() => null);
  return r ? BigInt(r.value.amount) : 0n;
}

function u64(n: bigint) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}
function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

/** An EVM address as a 32-byte Solana pubkey (left-padded), the form CCTP uses for recipients. */
export const evmAsPubkey = (a: Address) => new PublicKey(toBytes(a, { size: 32 }));

/**
 * The burn transaction. `event` is a fresh keypair for the message event account and must sign
 * too; the owner pays its rent and the transaction fee in SOL.
 */
export async function depositForBurnTx(owner: PublicKey, amount: bigint, maxFee: bigint, recipient: Address) {
  const event = Keypair.generate();
  const data = new Uint8Array([
    ...DEPOSIT_FOR_BURN,
    ...u64(amount),
    ...u32(ARC_DOMAIN),
    ...evmAsPubkey(recipient).toBytes(),
    ...new Uint8Array(32), // destination_caller: anyone may submit on Arc
    ...u64(maxFee),
    ...u32(FAST),
  ]);
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: owner, isSigner: true, isWritable: true }, // event_rent_payer
    { pubkey: pda(["sender_authority"], TMM), isSigner: false, isWritable: false },
    { pubkey: usdcAccount(owner), isSigner: false, isWritable: true },
    { pubkey: pda(["denylist_account", owner.toBytes()], TMM), isSigner: false, isWritable: false },
    { pubkey: pda(["message_transmitter"], MT), isSigner: false, isWritable: true },
    { pubkey: pda(["token_messenger"], TMM), isSigner: false, isWritable: false },
    { pubkey: pda(["remote_token_messenger", String(ARC_DOMAIN)], TMM), isSigner: false, isWritable: false },
    { pubkey: pda(["token_minter"], TMM), isSigner: false, isWritable: false },
    { pubkey: pda(["local_token", SOLANA_USDC.toBytes()], TMM), isSigner: false, isWritable: true },
    { pubkey: SOLANA_USDC, isSigner: false, isWritable: true },
    { pubkey: event.publicKey, isSigner: true, isWritable: true },
    { pubkey: MT, isSigner: false, isWritable: false },
    { pubkey: TMM, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: pda(["__event_authority"], TMM), isSigner: false, isWritable: false },
    { pubkey: TMM, isSigner: false, isWritable: false }, // program
  ];
  const tx = new Transaction().add(new TransactionInstruction({ programId: TMM, keys, data: Buffer.from(data) }));
  const { blockhash, lastValidBlockHeight } = await connection().getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner;
  tx.partialSign(event);
  return { tx, lastValidBlockHeight };
}

/* ------------------------------------------------------------------ the Solana wallet */

/** The subset of the Phantom / Solflare injected provider that HonorCat uses. */
export type SolanaProvider = {
  publicKey: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
  signTransaction(tx: Transaction): Promise<Transaction>;
};

export function solanaProvider(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: SolanaProvider }; solflare?: SolanaProvider & { isSolflare?: boolean }; solana?: SolanaProvider };
  return w.phantom?.solana ?? (w.solflare?.isSolflare ? w.solflare : null) ?? w.solana ?? null;
}

/**
 * The message a Solana wallet signs once to get its HonorCat account on Arc. Ed25519 signatures
 * are deterministic, so the same wallet always derives the same Arc key: no storage, works on any
 * device. Anyone holding this signature controls that Arc account, so the text says where to sign.
 */
export const ARC_ACCOUNT_MESSAGE = (owner: string) =>
  `HonorCat: open my Arc account for Solana wallet ${owner}.\n\nOnly sign this on the HonorCat site. It moves no money.`;

export async function deriveArcKey(provider: SolanaProvider): Promise<{ owner: PublicKey; key: Hex }> {
  const { publicKey } = await provider.connect();
  const { signature } = await provider.signMessage(enc.encode(ARC_ACCOUNT_MESSAGE(publicKey.toBase58())), "utf8");
  return { owner: publicKey, key: keccak256(signature) };
}

/** Signs the burn with the wallet, sends it to devnet and waits for confirmation. */
export async function sendBurn(provider: SolanaProvider, owner: PublicKey, amount: bigint, maxFee: bigint, recipient: Address): Promise<string> {
  const { tx, lastValidBlockHeight } = await depositForBurnTx(owner, amount, maxFee, recipient);
  const signed = await provider.signTransaction(tx);
  const c = connection();
  const sig = await c.sendRawTransaction(signed.serialize());
  const res = await c.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Solana rejected the transfer: ${JSON.stringify(res.value.err)}`);
  return sig;
}
