"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import { evidenceHash, evidenceRootOf, recordFromJson, STATUS_NAME, verifyRecord, type EvidenceRecord } from "@honorcat/relay/trigger";
import { GeminiCredit } from "@/components/cat/Markets";
import { CatHead } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { addressUrl, txUrl } from "@/lib/chain";
import { useEvidence, type RawSignature } from "@/lib/useEvidence";
import { useEarly } from "../EarlyView";

type Check = { signer: string; ok: boolean; message: string; record: EvidenceRecord | null; hash: string | null };
type Summary = { windowStart?: string; windowEnd?: string; averageMicro?: string; validCount?: string | number; sampleCount?: number; decision?: string; params?: { priceDecimals?: number | string }; dataSource?: string };

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const mono = { fontFamily: F.mono, fontSize: 13, overflowWrap: "anywhere" } as const;
const h2 = { margin: 0, fontFamily: F.cond, fontSize: 30, fontWeight: 600, lineHeight: 1.05 } as const;
const rule = { borderTop: `1.5px solid ${C.ink}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 } as const;

function recheck(sigs: RawSignature[]): Check[] {
  return sigs
    .filter((s) => s.kind === "trigger" && s.record)
    .map((s) => {
      try {
        const record = recordFromJson(s.record as never);
        const decision = verifyRecord(record);
        const hash = evidenceHash(record);
        const ok = decision.triggered && hash === s.evidenceHash;
        return { signer: s.signer, ok, message: ok ? "recomputed here: triggered, hash matches" : "does not recompute", record, hash };
      } catch (err) {
        return { signer: s.signer, ok: false, message: (err as Error).message, record: null, hash: null };
      }
    });
}

/**
 * The proof of an early payout. Public: the rule's commitment, each sampler's evidence hash and
 * computed values, the 2-of-3 signatures and the memo root. The raw order-book readings are Gemini
 * market data, so they go to the funder and recipients after one signature; with them, this page
 * recomputes every record and the root here, in the browser, with the samplers' own engine.
 */
export function EarlyProof() {
  const { id } = useParams<{ id: string }>();
  const { d, error } = useEarly(id);
  const ev = useEvidence(id);
  const checks = useMemo<Check[]>(() => (ev.data ? recheck(ev.data.signatures) : []), [ev.data]);

  if (error && !d) return <p style={{ fontSize: 17, color: C.signalInk }}>{error}</p>;
  if (!d) return <p style={{ fontSize: 17, color: C.muted }}>Loading…</p>;
  const e = d.early;
  const triggers = d.signatures.filter((s) => s.kind === "trigger");
  const okOnes = checks.filter((c) => c.ok && c.record).sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1)).slice(0, 2);
  const root = okOnes.length === 2 ? evidenceRootOf(okOnes.map((c) => c.hash as `0x${string}`)) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36, maxWidth: 860 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 56, fontWeight: 600, lineHeight: 0.95 }}>Proof</h1>
        <p style={{ margin: 0, fontSize: 18, lineHeight: 1.45, color: C.body }}>{e.promise}</p>
        <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
          Gemini contract <span style={mono}>{e.instrument}</span> ({e.side.toUpperCase()} side) of “{e.eventTitle}”. Each sampler reads Gemini’s public order book
          on its own. <GeminiCredit />
        </p>
      </section>

      <section style={rule}>
        <h2 style={h2}>What anyone can check</h2>
        <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8, fontSize: 16, lineHeight: 1.45, color: C.body }}>
          <li>
            The rule cannot change: the pot’s conditionId <span style={mono}>{e.conditionId}</span> is the hash of the contract, side, mode and every parameter.
          </li>
          <li>
            Each sampler signed the hash of its record. Two signatures of the 2-of-3 resolver{" "}
            <a style={mono} href={addressUrl(e.resolver)} target="_blank" rel="noreferrer">
              {e.resolver.slice(0, 10)}…
            </a>{" "}
            released the money.
          </li>
          <li>
            The payout memo on Arc carries the evidence root {e.evidenceRoot ? <span style={mono}>{e.evidenceRoot}</span> : "(after a trigger)"}.
            {e.settledTx?.startsWith("0x") && (
              <>
                {" "}
                <a href={txUrl(e.settledTx)} target="_blank" rel="noreferrer">
                  Open the payout transaction
                </a>
                .
              </>
            )}
          </li>
        </ol>
        {triggers.length === 0 && (
          <p style={{ margin: 0, fontSize: 16, color: C.muted }}>
            No trigger evidence yet. {e.state === "refunded" ? "This pot did not pay early." : "Records appear here when a sampler sees the rule met."}
          </p>
        )}
        {triggers.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1px solid ${C.faint}` }}>
            {triggers.map((s) => {
              const r = (s.record ?? {}) as Summary;
              const dec = Number(r.params?.priceDecimals ?? 2);
              const avg = r.averageMicro ? (Number(r.averageMicro) / 10 ** (dec + 6)) * 100 : null;
              return (
                <li key={s.signer} style={{ borderBottom: `1px solid ${C.faint}`, padding: "10px 0", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <CatHead width={18} height={17} style={{ marginTop: 3 }} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>
                      Sampler <span style={mono}>{s.signer.slice(0, 10)}…</span>: {r.decision ?? (s.outcome ? "triggered" : "no payout")}
                    </span>
                    <span style={{ fontSize: 14, color: C.muted }}>
                      {r.windowStart && r.windowEnd ? `Window ${clock(Number(r.windowStart))} to ${clock(Number(r.windowEnd))}, ` : ""}
                      {r.validCount ?? "?"} valid of {r.sampleCount ?? "?"} readings{avg !== null ? `, average ${avg.toFixed(2)}%` : ""}.
                    </span>
                    <span style={mono}>evidence hash {s.evidenceHash}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={rule}>
        <h2 style={h2}>The raw readings</h2>
        {!ev.data ? (
          <>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, color: C.body }}>
              Every reading’s bid, ask and sizes, and a recomputation of each record and of the root in this browser. Open to this payout’s funder and the people who
              joined it: sign once to see them.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {ev.hasPasskey && (
                <button
                  type="button"
                  onClick={ev.withPasskey}
                  disabled={ev.busy}
                  style={{ alignSelf: "flex-start", minHeight: 52, padding: "0 22px", background: C.ink, color: C.page, border: 0, fontFamily: F.sans, fontSize: 18, fontWeight: 600, cursor: "pointer" }}
                >
                  {ev.busy ? "Checking…" : "Show them with my passkey"}
                </button>
              )}
              <WalletChoice label={ev.hasPasskey ? "Use a wallet instead" : "Show them with my wallet"} onPick={(k) => void ev.withWallet(k)} busy={ev.busy} />
            </div>
            {ev.error && <p style={{ margin: 0, fontSize: 14, color: C.signalInk }}>{ev.error}</p>}
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: C.muted }}>
              Why not public: the readings are Gemini market data, which Gemini’s Market Data Agreement does not let us republish. This makes the proof less public:
              outsiders can check the hashes, signatures and memo root, but only members can recompute the records. The stored records and hashes are unchanged.
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
              Signed in as <span style={mono}>{ev.data.viewer}</span>.{" "}
              {root ? (root === e.evidenceRoot ? "The root recomputed here matches the payout memo." : `Recomputed root ${root} does not match.`) : ""}
            </p>
            {checks.map((c) => (
              <div key={c.signer} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${C.faint}`, paddingTop: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: c.ok ? C.ink : C.signalInk }}>
                  Sampler <span style={mono}>{c.signer.slice(0, 10)}…</span>: {c.message}
                </span>
                {c.record && (
                  <>
                    <span style={{ fontSize: 14, color: C.muted }}>
                      Source {c.record.dataSource}. Hash <span style={mono}>{c.hash}</span>
                    </span>
                    <div style={{ maxHeight: 256, overflow: "auto", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}` }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F.mono, fontSize: 13 }}>
                        <thead>
                          <tr style={{ color: C.muted }}>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 400 }}>time</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 400 }}>bid</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 400 }}>ask</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 400 }}>sizes</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 400 }}>status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.record.samples.map((s) => (
                            <tr key={s.t} style={{ color: s.status === 0 ? C.ink : C.muted }}>
                              <td style={{ padding: "2px 8px" }}>{clock(s.t)}</td>
                              <td style={{ padding: "2px 8px", textAlign: "right" }}>{s.bid.toString()}</td>
                              <td style={{ padding: "2px 8px", textAlign: "right" }}>{s.ask.toString()}</td>
                              <td style={{ padding: "2px 8px", textAlign: "right" }}>
                                {s.bidSize.toString()}/{s.askSize.toString()}
                              </td>
                              <td style={{ padding: "2px 8px" }}>{STATUS_NAME[s.status]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <a
                      style={{ fontSize: 14 }}
                      download={`evidence-${e.id}-${c.signer.slice(0, 8)}.json`}
                      href={`data:application/json,${encodeURIComponent(JSON.stringify(ev.data!.signatures.find((s) => s.signer === c.signer)?.record ?? {}, null, 2))}`}
                    >
                      Download this record (JSON)
                    </a>
                  </>
                )}
              </div>
            ))}
            <GeminiCredit />
          </>
        )}
      </section>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: C.muted }}>
        What this does not prove: that a sampler’s readings really came from Gemini. That is why two independent samplers on different hosts must each see the trigger
        in their own data. The vault checks the resolver’s signatures, not the evidence. An early payout is final; the market can be wrong.
      </p>

      {d.signatures.filter((s) => s.kind !== "trigger").length > 0 && (
        <section style={rule}>
          <h2 style={h2}>Other signed results</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {d.signatures
              .filter((s) => s.kind !== "trigger")
              .map((s) => (
                <li key={`${s.signer}-${s.kind}`}>
                  <span style={mono}>{s.signer.slice(0, 10)}…</span> {s.kind} ({s.outcome ? "pay" : "no payout"}): {(s.record as { reason?: string } | null)?.reason}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
