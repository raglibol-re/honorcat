import { C, F } from "@/components/cat/tokens";

export const metadata = { title: { absolute: "Developers · HonorCat" } };

const ENDPOINTS: [string, string][] = [
  ["GET /api/catalog", "Every active Gemini prediction contract with its measured quality under the HonorCat rule (filters: category, within, q, usable)."],
  ["GET /api/catalog/quote?symbol=…", "One contract's order book now: best bid and ask, sizes, depth near the price, quality."],
  ["GET /api/status", "The relay: balance, runway, gas spent per transaction kind, indexer and Streams health."],
  ["GET /api/streams", "QuickNode Streams deliveries: block ranges, delay, which path saw each event first."],
  ["GET /api/early, /api/early/{id}", "Retired early payouts (read-only): terms, state, payments, evidence hashes and computed values."],
  ["GET /api/health", "Liveness."],
];

const mono = { fontFamily: F.mono, fontSize: 14 } as const;

export default function DevelopersPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36, maxWidth: 860 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Build on HonorCat</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body }}>
          HonorCat is a pot between two sides on a Gemini market, fully collateralised in USDC on Arc. Each side’s share follows the market, and either side can
          exit at a forward-priced fair value. The pot contract, with transferable positions and a fair-value read function other contracts can use, is being
          built now; this page lists what is available today.
        </p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1.5px solid ${C.ink}`, paddingTop: 14 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Public read API</h2>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {ENDPOINTS.map(([path, what]) => (
            <li key={path} style={{ borderBottom: `1px solid ${C.faint}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={mono}>{path}</span>
              <span style={{ fontSize: 16, lineHeight: 1.45, color: C.body }}>{what}</span>
            </li>
          ))}
        </ul>
        <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
          JSON, no key, testnet only. Prices are Gemini market data: show “Data provided by Gemini” with a link wherever you display them.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1.5px solid ${C.ink}`, paddingTop: 14 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Coming next</h2>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, color: C.body }}>
          The two-sided pot contract on Arc testnet (positions as transferable tokens, M-of-N price attestations anyone can submit, a fair-value read for a
          position), a small SDK for pots, and the events stream for every pot event. The retired contracts (VerdictVault, GuaranteeBook, BatchGuard,
          MerkleBook) are listed in the README.
        </p>
      </section>
    </div>
  );
}
