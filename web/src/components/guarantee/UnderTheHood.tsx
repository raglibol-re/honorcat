"use client";

import { addressUrl, txUrl } from "@/lib/chain";
import type { GuaranteeDetail } from "@/lib/guarantees";

const PATH_LABEL: Record<string, string> = { streams: "QuickNode Stream", rpc: "RPC poller", receipt: "relay receipt" };

/** Collapsed-by-default technical detail: what was signed, by whom, and how each event reached us. */
export function UnderTheHood({ d, account }: { d: GuaranteeDetail; account?: string | null }) {
  return (
    <details className="hc-ticket group px-5 py-4">
      <summary className="t-15 cursor-pointer select-none font-medium">Under the hood</summary>
      <div className="t-13 mt-4 space-y-5">
        <section>
          <h3 className="font-medium">Signed result</h3>
          {d.resolution?.signedPayload ? (
            <>
              <p className="mt-1" style={{ color: "var(--hc-muted)" }}>
                EIP-712 resolution signed by the resolver and verified by the vault on Arc.
              </p>
              <pre className="mono mt-2 overflow-x-auto p-3 text-[12px] leading-5" style={{ background: "var(--hc-page)" }}>
                {JSON.stringify(d.resolution.signedPayload, null, 2)}
              </pre>
            </>
          ) : (
            <p className="mt-1" style={{ color: "var(--hc-muted)" }}>
              Not signed yet. The resolver signs once Gemini settles the market.
            </p>
          )}
        </section>

        <section>
          <h3 className="font-medium">Who decides</h3>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt style={{ color: "var(--hc-muted)" }}>Resolver</dt>
            <dd>
              <a className="mono hover:underline" href={addressUrl(d.chain.resolver)} target="_blank" rel="noreferrer">
                {d.chain.resolver}
              </a>
            </dd>
            <dt style={{ color: "var(--hc-muted)" }}>Market</dt>
            <dd className="mono">
              {d.guarantee.eventTicker}:{d.guarantee.contractTicker} ({d.guarantee.side === "yes" ? "refund if it settles Yes" : "refund if it settles No"})
            </dd>
            <dt style={{ color: "var(--hc-muted)" }}>Condition</dt>
            <dd className="mono break-all">{d.guarantee.conditionId}</dd>
          </dl>
        </section>

        <section>
          <h3 className="font-medium">How each event reached HonorCat first</h3>
          <ul className="mt-1 space-y-1">
            {d.events.map((e) => (
              <li key={`${e.txHash}-${e.logIndex}`} className="flex flex-wrap justify-between gap-x-3">
                <span>{e.name}</span>
                <span style={{ color: "var(--hc-muted)" }}>
                  {PATH_LABEL[e.firstSeenVia] ?? e.firstSeenVia},{" "}
                  <a className="mono hover:underline" href={txUrl(e.txHash)} target="_blank" rel="noreferrer">
                    #{e.block.toLocaleString("en-US")}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="font-medium">Membership proof</h3>
          <p className="mt-1" style={{ color: "var(--hc-muted)" }}>
            This guarantee uses a fixed list of up to {d.guarantee.maxCustomers} customers stored in the GuaranteeBook contract, so there is no
            Merkle proof. {account ? (
              <>
                Your account <span className="mono">{account}</span> is checked with <span className="mono">isCustomer({d.guarantee.gid}, account)</span>.
              </>
            ) : null}
          </p>
        </section>
      </div>
    </details>
  );
}
