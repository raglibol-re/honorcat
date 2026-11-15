"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import { evidenceHash, evidenceRootOf, recordFromJson, STATUS_NAME, verifyRecord, type EvidenceRecord } from "@verdict/relay/trigger";
import { addressUrl, txUrl } from "@/lib/chain";
import { useEarly } from "../EarlyView";

type Check = { signer: string; ok: boolean; message: string; record: EvidenceRecord | null; hash: string | null };

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Everything a visitor needs to check an early payout without trusting HonorCat: the Gemini
 * contract, every sampler's samples, the rule, the signatures, and a recomputation done here, in
 * this browser, with the same engine the samplers run.
 */
export function EarlyProof() {
  const { id } = useParams<{ id: string }>();
  const { d, error } = useEarly(id);

  const checks = useMemo<Check[]>(() => {
    if (!d) return [];
    return d.signatures
      .filter((s) => s.kind === "trigger" && s.record)
      .map((s) => {
        try {
          const record = recordFromJson(s.record!);
          const decision = verifyRecord(record);
          const hash = evidenceHash(record);
          const ok = decision.triggered && hash === s.evidenceHash;
          return { signer: s.signer, ok, message: ok ? "recomputed here: triggered, hash matches" : "does not recompute", record, hash };
        } catch (err) {
          return { signer: s.signer, ok: false, message: (err as Error).message, record: null, hash: null };
        }
      });
  }, [d]);

  if (error && !d) return <p className="t-15" style={{ color: "var(--negative)" }}>{error}</p>;
  if (!d) return <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>;
  const e = d.early;
  const okOnes = checks.filter((c) => c.ok && c.record).sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1)).slice(0, 2);
  const root = okOnes.length === 2 ? evidenceRootOf(okOnes.map((c) => c.hash as `0x${string}`)) : null;

  return (
    <div className="space-y-5">
      <section className="vg-ticket space-y-2 px-5 py-4">
        <h1 className="t-21 font-semibold">Public proof</h1>
        <p className="t-15">{e.promise}</p>
        <p className="t-13" style={{ color: "var(--vg-muted)" }}>
          Gemini contract <span className="mono">{e.instrument}</span> ({e.side.toUpperCase()} side) of “{e.eventTitle}”. Data: Gemini’s public
          order book, read independently by each sampler.
        </p>
      </section>

      <section className="vg-ticket space-y-2 px-5 py-4">
        <h2 className="t-17 font-medium">What you can check yourself</h2>
        <ol className="t-15 list-decimal space-y-1.5 pl-5">
          <li>
            The rule cannot change: the pot’s conditionId <span className="mono t-13 break-all">{e.conditionId}</span> is the hash of the
            contract, side, pot mode and every parameter. Read the pot on the explorer and compare.
          </li>
          <li>Each sampler’s record below is recomputed in this browser with the same engine: every sample’s status, the average and the decision.</li>
          <li>
            Each record’s hash is signed by its sampler, and two signatures of the samplers’ 2-of-3 resolver{" "}
            <a className="mono t-13 hover:underline" href={addressUrl(e.resolver)} target="_blank" rel="noreferrer">
              {e.resolver.slice(0, 10)}…
            </a>{" "}
            released the money.
          </li>
          <li>
            The payout memo on Arc carries the evidence root{e.evidenceRoot ? <> <span className="mono t-13 break-all">{e.evidenceRoot}</span></> : " (after a trigger)"}
            {root ? (root === e.evidenceRoot ? ", which matches the root recomputed here." : `; recomputed here: ${root} (does not match).`) : "."}
            {e.settledTx?.startsWith("0x") && (
              <>
                {" "}
                <a className="underline" href={txUrl(e.settledTx)} target="_blank" rel="noreferrer">
                  Open the payout transaction
                </a>
                .
              </>
            )}
          </li>
        </ol>
        <p className="t-13" style={{ color: "var(--vg-muted)" }}>
          What this does not prove: that a sampler’s quotes really came from Gemini. That is why two independent samplers on different hosts
          must each see the trigger in their own data. The vault itself only checks the resolver’s signatures, not the evidence.
        </p>
      </section>

      {checks.length === 0 && (
        <p className="t-15" style={{ color: "var(--vg-muted)" }}>
          No trigger evidence yet. {e.state === "refunded" ? "This pot did not pay early." : "Records appear here when a sampler sees the rule met."}
        </p>
      )}

      {checks.map((c) => (
        <section key={c.signer} className="vg-ticket space-y-2 px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="t-15 font-medium">
              Sampler <span className="mono">{c.signer.slice(0, 10)}…</span>
            </h2>
            <span className="t-13 font-medium" style={{ color: c.ok ? "var(--vg-accent)" : "var(--negative)" }}>
              {c.ok ? "✓ " : "✗ "}
              {c.message}
            </span>
          </div>
          {c.record && (
            <>
              <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                Window {clock(c.record.windowStart)}–{clock(c.record.windowEnd)}, {c.record.validCount} valid of {c.record.samples.length} samples, average{" "}
                {(Number(c.record.averageMicro) / 10 ** (c.record.params.priceDecimals + 6) * 100).toFixed(2)}%. Source: {c.record.dataSource}. Evidence
                hash <span className="mono break-all">{c.hash}</span>
              </p>
              <div className="max-h-64 overflow-auto rounded-lg border" style={{ borderColor: "var(--vg-rule)" }}>
                <table className="t-13 mono w-full">
                  <thead>
                    <tr style={{ color: "var(--vg-muted)" }}>
                      <th className="px-2 py-1 text-left font-normal">time</th>
                      <th className="px-2 py-1 text-right font-normal">bid</th>
                      <th className="px-2 py-1 text-right font-normal">ask</th>
                      <th className="px-2 py-1 text-right font-normal">sizes</th>
                      <th className="px-2 py-1 text-left font-normal">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.record.samples.map((s) => (
                      <tr key={s.t} style={{ color: s.status === 0 ? undefined : "var(--vg-muted)" }}>
                        <td className="px-2 py-0.5">{clock(s.t)}</td>
                        <td className="px-2 py-0.5 text-right">{s.bid.toString()}</td>
                        <td className="px-2 py-0.5 text-right">{s.ask.toString()}</td>
                        <td className="px-2 py-0.5 text-right">
                          {s.bidSize.toString()}/{s.askSize.toString()}
                        </td>
                        <td className="px-2 py-0.5">{STATUS_NAME[s.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <a
                className="t-13 underline"
                download={`evidence-${e.id}-${c.signer.slice(0, 8)}.json`}
                href={`data:application/json,${encodeURIComponent(JSON.stringify(d.signatures.find((s) => s.signer === c.signer)?.record ?? {}, null, 2))}`}
              >
                Download this record (JSON)
              </a>
            </>
          )}
        </section>
      ))}

      {d.signatures.filter((s) => s.kind !== "trigger").length > 0 && (
        <section className="vg-ticket px-5 py-4">
          <h2 className="t-15 font-medium">Other signed results</h2>
          <ul className="t-13 mt-2 space-y-1">
            {d.signatures
              .filter((s) => s.kind !== "trigger")
              .map((s) => (
                <li key={`${s.signer}-${s.kind}`}>
                  <span className="mono">{s.signer.slice(0, 10)}…</span> {s.kind} ({s.outcome ? "pay" : "no payout"}): {(s.record as { reason?: string } | null)?.reason}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
