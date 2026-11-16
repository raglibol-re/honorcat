"use client";

import Link from "next/link";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";

type Evidence = {
  events: { event_name: string; n: string; streams: string; rpc: string; last_tx: string; last_pot: string | null; last_time: string | null }[];
  windows: { n: string; three: string; two: string; none: string; quotes: string; onchain: string };
  streamsSinceFilter?: { sinceBlock: string; total: number; streams: number; pollerLagBlocks: number };
  circle?: { relayWallet: string | null; sentByCircle: number; gatewayMints: number; lastGatewayMint: string | null; lastCircleTx: string | null; faucetApi: string };
  agents?: { agentPots: number; agentActions: number; seats: number } | null;
  medianWindowToPaidMs: number | null;
  contracts: { pots: string | null; fairValue: string | null };
};

type Status = "done" | "partly" | "not yet";
type Item = { what: string; check: string; status: Status; proof: React.ReactNode };

const mark: Record<Status, { text: string; color: string }> = {
  done: { text: "Done", color: C.ink },
  partly: { text: "Partly", color: C.signalInk },
  "not yet": { text: "Not yet", color: C.muted },
};

function List({ title, items }: { title: string; items: Item[] }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 40, fontWeight: 600 }}>{title}</h2>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
        {items.map((it) => (
          <li key={it.what} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 90px", gap: "4px 16px", padding: "14px 0", borderBottom: `1px solid ${C.faint}` }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <strong style={{ fontSize: 18 }}>{it.what}</strong>
              <span style={{ fontSize: 15, color: C.muted }}>Check: {it.check}</span>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: C.body }}>{it.proof}</span>
            </div>
            <span style={{ fontWeight: 600, color: mark[it.status].color, textAlign: "right" }}>{mark[it.status].text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Built() {
  const { data: e } = usePolling<Evidence>("/api/hc/evidence", 15_000);
  const ev = (name: string) => e?.events.find((x) => x.event_name === name);
  const last = (name: string, label?: string) => {
    const x = ev(name);
    if (!x) return <em>none yet</em>;
    return (
      <>
        {x.n} so far; newest <a href={txUrl(x.last_tx)} target="_blank" rel="noreferrer">{label ?? "transaction"}</a>
        {x.last_pot && (
          <>
            {" "}
            in <Link href={`/pots/${x.last_pot}`}>pot {x.last_pot}</Link>
          </>
        )}
      </>
    );
  };
  const ss = e?.streamsSinceFilter;
  const settled = ev("PotSettled");

  const arc: Item[] = [
    { what: "USDC is the only asset, including the fee for every transaction", check: "the relay pays gas in USDC", status: "done", proof: <>Gas spent per kind of transaction is on <Link href="/status">status</Link>. Pots, deposits, payouts and fees are all USDC (6 decimals through the ERC-20 view).</> },
    { what: "Join and exit without gas worries", check: "passkey accounts pay nothing; wallets pay a fraction of a cent in USDC", status: "done", proof: <>Passkey accounts sign and HonorCat pays the fee. Browser wallets send ordinary transactions (an exact-amount USDC approval, then the deposit), the way wallets expect, so nothing is ever pulled by an off-chain signature; on Arc the fee is USDC too. EIP-3009 deposits and EIP-712 exit requests remain available through /api/hc/forward for integrators. Joins: {last("JoinRequested")}. Exits: {last("ExitRequested")}.</> },
    { what: "Create-and-fund and divide-and-pay are single transactions", check: "one transaction each, through Multicall3From", status: "done", proof: <>Creating a pot pulls the deposit in the same call; an exit price pays both sides in the same call. Created: {last("PotCreated")}. Divided: {last("PotDivided")}.</> },
    { what: "The reason for every payout travels with it (Arc Memo)", check: "the memo decoded on the pot page", status: "done", proof: <>Every relay transaction carries a Memo with the pot and the reason (for example the exit price and the agreement rule); each pot page shows it with its window, read back from the transaction on Arc.</> },
    { what: "Time from the end of a price window to the payout", check: "measured", status: e?.medianWindowToPaidMs ? "done" : "partly", proof: <>Median from the end of a measured window to the transaction that used it: {e?.medianWindowToPaidMs ? `${(e.medianWindowToPaidMs / 1000).toFixed(1)} s` : "…"} (the samplers wait for the window, agree, and the relay waits for Arc&apos;s block clock).</> },
    {
      what: "Relay keys held by Circle (developer-controlled wallet)",
      check: "pot transactions sent from the Circle wallet",
      status: e?.circle?.sentByCircle ? "done" : "partly",
      proof: (
        <>
          Every pot transaction HonorCat sends (prices, settlements, gifts, the practice cat, Gateway mints) is signed by Circle for the wallet{" "}
          {e?.circle?.relayWallet ? (
            <a href={addressUrl(e.circle.relayWallet)} target="_blank" rel="noreferrer">
              {e.circle.relayWallet.slice(0, 10)}…
            </a>
          ) : (
            "…"
          )}
          ; the app holds no private key for it. {e?.circle ? `${e.circle.sentByCircle} transactions so far` : ""}
          {e?.circle?.lastCircleTx && (
            <>
              ; newest{" "}
              <a href={txUrl(e.circle.lastCircleTx)} target="_blank" rel="noreferrer">
                transaction
              </a>
            </>
          )}
          . The price samplers keep their own keys on purpose: three independent signers.
        </>
      ),
    },
    {
      what: "Circle Gateway: a transfer attested by Circle and minted into an HonorCat account on Arc",
      check: "a Gateway transfer run end to end (from Arc's own Gateway balance)",
      status: e?.circle?.gatewayMints ? "done" : "partly",
      proof: (
        <>
          Deposit USDC on Base, Ethereum, Avalanche, Arbitrum, Optimism, Polygon or Arc into one Gateway balance, then move it into a HonorCat account on Arc with one signature: Circle
          attests, the relay mints. Run end to end from a Gateway balance on Arc (deposit, Circle&apos;s attestation, mint); deposits on the other chains use the same path but were not run here, as we
          hold no test USDC on them. {e?.circle ? `${e.circle.gatewayMints} Gateway mints recorded since the database was rebuilt` : ""}
          {e?.circle?.lastGatewayMint && (
            <>
              ; newest{" "}
              <a href={txUrl(e.circle.lastGatewayMint)} target="_blank" rel="noreferrer">
                mint
              </a>
            </>
          )}
          . On the <Link href="/account#gateway">account page</Link>. Solana Devnet still comes over with CCTP.
        </>
      ),
    },
    {
      what: "Test money without faucets",
      check: "new accounts funded, the pool refilled",
      status: "partly",
      proof: <>Every new account gets $2 and deposits are topped up from HonorCat&apos;s pool. Refilling the pool from Circle&apos;s faucet API every 3 hours is built; {e?.circle?.faucetApi ?? "…"}.</>,
    },
  ];
  const gemini: Item[] = [
    { what: "Market discovery and quality from the order book", check: "/markets and /api/catalog", status: "done", proof: <>Every active contract ranked by spread and depth: <Link href="/markets">markets</Link>.</> },
    { what: "The live price sets each side's share", check: "the rope matches the book midpoint", status: "done", proof: <>The rope reads Gemini&apos;s book every 2 s and averages 30 s, like the samplers.</> },
    { what: "A forward-window average prices every exit", check: "the evidence of an exit", status: "done", proof: <>{e
          ? `${e.windows.n} price windows so far: ${e.windows.three} priced by the median of three, ${e.windows.two} by the mean of two, ${e.windows.none} without a price (${e.windows.quotes} of them fair-value quotes, ${e.windows.onchain} with the rule checked on-chain).`
          : "…"} Each pot&apos;s proof page lists every sampler&apos;s average and evidence hash.</> },
    { what: "Market status gates exits", check: "no price while halted or under review", status: "done", proof: <>The relay proposes no price unless Gemini reports the contract active and open; without a price nothing moves.</> },
    { what: "Gemini's settlement ends the pots nobody left", check: "a pot held to settlement", status: settled ? "done" : "partly", proof: settled ? <>{last("PotSettled")}.</> : <>The first pot held to the end is waiting for Gemini&apos;s result.</> },
    { what: "Depth sets the cap on a pot's size", check: "creation refused above the cap", status: "done", proof: <>The signer set attests the contracts within 5 cents on the thinner side; the contract allows 25 cents of pot per contract, at most $25 (contract tests: AboveCap).</> },
    { what: "“Data provided by Gemini” wherever prices appear", check: "page check", status: "done", proof: <>On the rope, the pot, proof, markets and landing pages.</> },
  ];
  const quicknode: Item[] = [
    {
      what: "Streams is the primary source for every pot event",
      check: "the share of pot events first seen by Streams since the stream resumed",
      status: ss && ss.total > 0 && ss.streams / ss.total >= 0.5 ? "done" : "partly",
      proof: (
        <>
          {ss
            ? `Since block ${Number(ss.sinceBlock).toLocaleString("en-US")}: ${ss.streams} of ${ss.total} pot events first seen by Streams (${ss.total ? Math.round((100 * ss.streams) / ss.total) : 0}%). `
            : "… "}
          The RPC poller trails the chain head by {ss?.pollerLagBlocks ?? 90} blocks (about a minute), so Streams delivers first and polling only fills gaps. Events before that block were rebuilt from
          the chain on 16 November, after the database moved to a new project, so they are counted from that block on.
        </>
      ),
    },
    { what: "Filtered on QuickNode's side; RPC polling as the fallback", check: "the filter and the poller", status: "done", proof: <>The stream&apos;s filter keeps only our contracts&apos; logs (and Memo logs of our transactions); the relay polls the chain from its last block as a fallback. Per-delivery delay: <Link href="/live">live</Link>.</> },
    { what: "Backfill after downtime", check: "a documented run", status: "done", proof: <>The pot indexer resumes from its stored block; it backfilled every pot event from the contract&apos;s deploy block today.</> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 44, maxWidth: 920 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>How it is built</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body }}>
          What each part does, how to check it, and the live evidence. Contracts on Arc testnet:{" "}
          {e?.contracts.pots && (
            <a href={addressUrl(e.contracts.pots)} target="_blank" rel="noreferrer">
              HonorCatPots
            </a>
          )}
          {e?.contracts.fairValue && (
            <>
              ,{" "}
              <a href={addressUrl(e.contracts.fairValue)} target="_blank" rel="noreferrer">
                HonorCatFairValue
              </a>
            </>
          )}
          . Source, tests and the design document are in the repository.
        </p>
      </header>
      <List title="Arc" items={arc} />
      <List title="Gemini" items={gemini} />
      <List title="QuickNode" items={quicknode} />
      <List
        title="Grok Bot"
        items={[
          {
            what: "Grok Bot plays and minds pots through an MCP connector",
            check: "a seat, its tool calls and the pots it played",
            status: (e?.agents?.agentPots ?? 0) > 0 ? "done" : (e?.agents?.seats ?? 0) > 0 ? "partly" : "not yet",
            proof: (
              <>
                A player gives their Grok Bot a seat (signed, revocable, 24 hours) and adds HonorCat as a custom connector (<code>/api/mcp</code>, the seat token in the Authorization header). Every tool
                call is checked against the seat&apos;s action list, limits and per-pot powers, and logged with the agent&apos;s one-line reason. Live: {e?.agents?.seats ?? 0} seats,{" "}
                {e?.agents?.agentActions ?? 0} agent actions, <strong>{e?.agents?.agentPots ?? 0} pots played by an agent</strong>. <Link href="/grok-bot">How to invite your Grok Bot</Link>.
              </>
            ),
          },
          {
            what: "No key leaves HonorCat; agents never withdraw",
            check: "the tool list and the tests",
            status: "done",
            proof: (
              <>
                As an opponent the agent holds a side with HonorCat&apos;s practice wallet (Circle-held); as a cat sitter it acts alone only on exits the player signed in advance and proposes everything
                else. No tool withdraws, creates real pots or changes settings (relay/test/agent-seats.test.ts).
              </>
            ),
          },
        ]}
      />
      <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Data provided by Gemini. Test version on Arc testnet: test money only.</p>
    </div>
  );
}
