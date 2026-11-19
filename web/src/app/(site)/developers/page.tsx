import { C, F } from "@/components/cat/tokens";
import { addressUrl } from "@/lib/chain";

export const metadata = { title: { absolute: "Developers · HonorCat" } };

const ENDPOINTS: [string, string][] = [
  ["GET /api/hc/pots?owner=0x…&state=open|running", "Two-sided pots: state, sizes, deposits, owners, market, nets and bowls."],
  ["GET /api/hc/pots/{id}", "One pot with every measured window: each sampler's average, the agreed price, the rule that chose it, the transaction."],
  ["POST /api/hc/pots/{id}/quote, GET …/quote", "A signed fair-value quote (a 30-second window the samplers sign, which the pot never accepts). Feed it to HonorCatFairValue."],
  ["GET /api/hc/record/{address}", "An account's honor record: pots played, held to the end, exits (own, net, bowl), handshakes, takeovers, results."],
  ["POST /api/hc/prepare, GET /api/hc/depth?id=…", "The market rule, conditionId, close and the signer set's depth attestation (the cap) for a new pot."],
  ["POST /api/hc/forward", "Forwards a wallet-signed pot call (EIP-3009 deposit, signed exit request, handshake). HonorCat pays the fee; the contract checks every signature."],
  ["GET /api/hc/sampler/work?signer=…", "For samplers: windows to measure, proposals to co-sign, nets and bowls to watch."],
  ["GET /api/catalog, /api/catalog/quote?symbol=…", "Every active Gemini prediction contract with its measured quality; one contract's book now."],
  ["GET /api/status, /api/streams", "The relay (balance, gas per kind) and QuickNode Streams deliveries."],
];

const CONTRACTS: [string, string, string][] = [
  ["HonorCatRopes (v2.1, new pots)", "0x5489789bDdf63903c14bFc6B96c688A94cbBB62E", "v2 pots and short ropes: posts, lives, expiry, knock-out at a post, copycat and referral treats."],
  ["HonorCatPerps", "0x286588A69173b006c2A0D868C13c47d016c90CEB", "Perps: a chain of short ropes between two players, each with a budget of lives; rolls at the division price."],
  ["MedianResolver (v2 pots and perps)", "0xe554955192C3f0F0472920d4e70B2f8cA38817B3", "Prices from the samplers' own signed averages, computed on-chain (median of three, mean of two within half a point)."],
  ["HonorCatGroups", "0xDe28a5d9E328c09eb02A099f1480DE89E0FEb547", "Group pots: two teams on one market, joins and leaves cleared in one-minute batches, product-sum accounting."],
  ["MedianResolver (groups)", "0x1c952c9d7912c09135317B697c90224CA1BBc0eE", "The same resolver code, bound to the group contract."],
  ["HonorRoots", "0xd8A60838eD1AA25285a86bE7DDf589676c189c5C", "One Merkle root of all honor balances per day; verify(account, total, version, day, proof)."],
  ["HonorCatPots (v1)", "0xc890C990048f45cb268d076E4A3dB25270Ea1e59", "The pot: create, forward-priced join and exit, partial exits, handshake, nets and bowls, takeover, settle, expire. Sides are ERC-721 tokens (HCSIDE, tokenId = potId × 2 + side)."],
  ["HonorCatFairValue", "0x8a890a0A79371333dEaAF1aFC76D68ffDc7671a5", "fairValue(pots, side, quote, sigs, maxAge) → (share, exitFee, priceYes). Stateless; reverts on anything stale, unsigned or not a quote."],
  ["MedianResolver (v1)", "0x62FB60fbB5fC1903A4af3dc61186C2ed7f153c62", "The signer set of later v1 pots: computes each price on-chain from the samplers' own signed averages (median of three, mean of two within 0.5 points); plain 2-of-3 for depth and outcomes."],
  ["MultisigResolver", "0x81d1194069E1aD3a22C17356065d8dF6A4D436c9", "The samplers' 2-of-3 signer set of pots 1 to 7 (ERC-1271): co-signed prices, depth and outcomes."],
];

const mono = { fontFamily: F.mono, fontSize: 14, wordBreak: "break-all" } as const;

export default function DevelopersPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36, maxWidth: 860 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Build on HonorCat</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body }}>
          A pot between two sides on a Gemini market, fully collateralised in USDC on Arc testnet. Every price that moves money is a 30-second forward average signed by
          two of three independent samplers; anyone can submit it. Sides are tokens, and their value can be read on-chain from a signed quote.
        </p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1.5px solid ${C.ink}`, paddingTop: 14 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Contracts on Arc testnet</h2>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {CONTRACTS.map(([name, addr, what]) => (
            <li key={name} style={{ borderBottom: `1px solid ${C.faint}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontWeight: 600 }}>{name}</span>
              <a href={addressUrl(addr)} target="_blank" rel="noreferrer" style={mono}>
                {addr}
              </a>
              <span style={{ fontSize: 16, lineHeight: 1.45, color: C.body }}>{what}</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1.5px solid ${C.ink}`, paddingTop: 14 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>API</h2>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {ENDPOINTS.map(([path, what]) => (
            <li key={path} style={{ borderBottom: `1px solid ${C.faint}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={mono}>{path}</span>
              <span style={{ fontSize: 16, lineHeight: 1.45, color: C.body }}>{what}</span>
            </li>
          ))}
        </ul>
        <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
          JSON, no key, testnet only. Prices are Gemini market data: show &ldquo;Data provided by Gemini&rdquo; wherever you display them. Run your own sampler with{" "}
          <span style={mono}>pnpm --filter @honorcat/relay sampler</span>; the scripts <span style={mono}>relay/scripts/pots-e2e.ts</span> and{" "}
          <span style={mono}>pots-quote.ts</span> show every call end to end.
        </p>
      </section>
    </div>
  );
}
