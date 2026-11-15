"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SettlementRail } from "@/components/guarantee/SettlementRail";
import { UnderTheHood } from "@/components/guarantee/UnderTheHood";
import { usePolling } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { formatDate, formatUsdc } from "@/lib/format";
import { cardState, railFor, type GuaranteeDetail } from "@/lib/guarantees";

const EVENT_TEXT: Record<string, (a: Record<string, unknown>) => string> = {
  PotCreated: () => "Pot created in the vault",
  PotFunded: (a) => `${formatUsdc(String(a.amount))} USDC locked by the merchant`,
  GuaranteeOpened: (a) => `Refund terms attached: ${formatUsdc(String(a.refundAmount))} USDC for up to ${a.maxCustomers} customers`,
  Enrolled: (a) => `Customer ${String(a.seat)} enrolled`,
  PotResolved: (a) => `Result verified: ${a.outcome ? "refunds triggered" : "not triggered"}`,
  PotExpired: () => "No result in time; expired",
  Payout: (a) => `${formatUsdc(String(a.amount))} USDC moved to the GuaranteeBook`,
  Refund: (a) => `${formatUsdc(String(a.amount))} USDC returned to the merchant`,
  RefundPaid: (a) => `${formatUsdc(String(a.amount))} USDC refunded to a customer`,
  RefundDeferred: (a) => `${formatUsdc(String(a.amount))} USDC held as claimable for a customer`,
  LeftoverReturned: (a) => `${formatUsdc(String(a.amount))} USDC for unused places returned to the merchant`,
};

const short = (s: string, n = 8) => `${s.slice(0, n)}…${s.slice(-4)}`;

export function ProofView() {
  const { id } = useParams<{ id: string }>();
  const { data: d, error } = usePolling<GuaranteeDetail>(`/api/guarantees/${id}`, 4000);
  if (error && !d) return <p className="t-15">{error}</p>;
  if (!d) return <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>;

  const g = d.guarantee;
  const state = cardState(d);
  // group events by transaction, attach that transaction's memos
  const txs = new Map<string, { block: number; time: number | null; events: GuaranteeDetail["events"]; memos: GuaranteeDetail["memos"] }>();
  for (const e of d.events) {
    const t = txs.get(e.txHash) ?? { block: e.block, time: e.time, events: [], memos: [] };
    t.events.push(e);
    txs.set(e.txHash, t);
  }
  for (const m of d.memos) {
    const t = txs.get(m.txHash) ?? { block: m.block, time: m.time, events: [], memos: [] };
    t.memos.push(m);
    txs.set(m.txHash, t);
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="t-15" style={{ color: "var(--vg-muted)" }}>
          Public proof for a HonorCat guarantee from {g.merchantName}. HonorCat, settled by Verdict on Arc.
        </p>
        <h1 className="hc-long t-27 mt-1 max-w-3xl font-medium">{g.promise}</h1>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="vg-ticket px-5 py-4">
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            {state === "active" ? "Locked now" : "Pot total at settlement"}
          </p>
          <p className="mono t-27 mt-1">{d.onchain ? formatUsdc(d.onchain.potTotal) : "—"} USDC</p>
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            Read from the chain at block <span className="mono">{d.onchain ? Number(d.onchain.block).toLocaleString("en-US") : "—"}</span>
          </p>
        </div>
        <div className="vg-ticket px-5 py-4">
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            Customers enrolled
          </p>
          <p className="mono t-27 mt-1">
            {d.onchain?.enrolled ?? d.customers.length} / {g.maxCustomers}
          </p>
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            from the GuaranteeBook contract
          </p>
        </div>
        <div className="vg-ticket px-5 py-4">
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            Status
          </p>
          <p className="t-21 mt-1 font-medium">
            {state === "active" ? "Waiting for the market" : state === "refunded" ? "Refunds paid" : "Not triggered"}
          </p>
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            Gemini market {d.market?.status ?? "—"}
          </p>
        </div>
      </section>

      <section className="vg-ticket px-5 py-5">
        <SettlementRail steps={railFor(d, null)} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="vg-ticket px-5 py-4">
          <h2 className="t-17 font-medium">Where to check</h2>
          <dl className="t-15 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt style={{ color: "var(--vg-muted)" }}>Vault</dt>
            <dd>
              <a className="mono hover:underline" href={addressUrl(d.chain.vault)} target="_blank" rel="noreferrer">
                {short(d.chain.vault, 10)}
              </a>
            </dd>
            <dt style={{ color: "var(--vg-muted)" }}>Pot</dt>
            <dd className="mono">#{g.potId}</dd>
            <dt style={{ color: "var(--vg-muted)" }}>GuaranteeBook</dt>
            <dd>
              {d.chain.book ? (
                <a className="mono hover:underline" href={addressUrl(d.chain.book)} target="_blank" rel="noreferrer">
                  {short(d.chain.book, 10)}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt style={{ color: "var(--vg-muted)" }}>Guarantee</dt>
            <dd className="mono">#{g.gid}</dd>
            <dt style={{ color: "var(--vg-muted)" }}>Chain</dt>
            <dd>Arc testnet ({d.chain.chainId})</dd>
          </dl>
        </div>
        <div className="vg-ticket px-5 py-4">
          <h2 className="t-17 font-medium">The market it depends on</h2>
          <dl className="t-15 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt style={{ color: "var(--vg-muted)" }}>Gemini market</dt>
            <dd>{g.eventTitle}</dd>
            <dt style={{ color: "var(--vg-muted)" }}>Contract</dt>
            <dd>
              {g.contractLabel} <span className="mono t-13">({g.eventTicker}:{g.contractTicker})</span>
            </dd>
            <dt style={{ color: "var(--vg-muted)" }}>Refunds if</dt>
            <dd>it settles {g.side === "yes" ? "Yes" : "No"}</dd>
            <dt style={{ color: "var(--vg-muted)" }}>Settles</dt>
            <dd>{formatDate(g.settlesAt * 1000)}</dd>
            <dt style={{ color: "var(--vg-muted)" }}>Chance</dt>
            <dd>
              {d.market?.status === "settled" ? (
                <>settled {d.market.resolutionSide === "yes" ? "Yes" : "No"}</>
              ) : (
                <>
                  {d.market?.chanceOfRefund === null || d.market?.chanceOfRefund === undefined ? "—" : `${Math.round(d.market.chanceOfRefund * 100)}%`}{" "}
                  <span className="t-13" style={{ color: "var(--vg-muted)" }}>
                    estimate from the market price
                  </span>
                </>
              )}
            </dd>
          </dl>
        </div>
      </section>

      <section>
        <h2 className="t-17 font-medium">Every transaction so far</h2>
        <ol className="mt-3 space-y-3">
          {[...txs.entries()].map(([hash, t]) => (
            <li key={hash} className="vg-ticket px-5 py-4">
              <div className="t-13 flex flex-wrap items-baseline justify-between gap-2" style={{ color: "var(--vg-muted)" }}>
                <a className="mono hover:underline" href={txUrl(hash)} target="_blank" rel="noreferrer" style={{ color: "var(--vg-ink)" }}>
                  {short(hash, 12)}
                </a>
                <span>
                  block <span className="mono">{t.block.toLocaleString("en-US")}</span>
                  {t.time ? `, ${formatDate(t.time * 1000)}` : ""}
                </span>
              </div>
              <ul className="t-15 mt-2 space-y-1">
                {t.events.map((e) => (
                  <li key={e.logIndex}>{EVENT_TEXT[e.name]?.(e.args) ?? e.name}</li>
                ))}
              </ul>
              {t.memos.map((m) => (
                <p key={m.logIndex} className="t-13 mt-2" style={{ color: "var(--vg-muted)" }}>
                  Memo: {(m.body?.why as string | undefined) ?? m.text ?? "—"}
                </p>
              ))}
            </li>
          ))}
        </ol>
      </section>

      <p className="t-15">
        <Link href={`/g/${id}`} className="underline underline-offset-4">
          Back to the guarantee
        </Link>
      </p>
      <UnderTheHood d={d} />
    </div>
  );
}
