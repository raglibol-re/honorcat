"use client";

import { useSearchParams } from "next/navigation";

import { CatState } from "@/components/cat/CatState";
import Link from "next/link";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { formatDate } from "@/lib/format";
import type { HcPot } from "@/lib/hc";
import { RawReadings } from "./RawReadings";

const POTS = "0xc890C990048f45cb268d076E4A3dB25270Ea1e59";
const mono: React.CSSProperties = { fontFamily: F.mono, fontSize: 13, wordBreak: "break-all" };
const KIND_TEXT = ["Entry price", "Exit price", "YES net", "NO net", "YES bowl", "NO bowl", "Quote (fair value, moves no money)"];

/**
 * What anyone can check about a pot: the contract, the market rule it commits to, and for every
 * measured window each sampler's average and the hash of its evidence record, the agreed price and
 * the transaction that used it. The raw samples stay with the samplers and the two sides (Gemini's
 * market-data terms); their hashes are here.
 */
export function Proof({ id }: { id: string }) {
  const k = useSearchParams().get("k");
  const { data: pot, error } = usePolling<HcPot>(`/api/hc/pots/${id}${k ? `?k=${encodeURIComponent(k)}` : ""}`, 15_000);
  if (!pot) return error ? <CatState kind="error" text={(/404|not found|no such/i.test(error) ? "There is nothing at this address. Check the link." : /private/i.test(error) ? "This pot is private: open it from its private link." : error)} /> : <CatState kind="loading" />;
  const windows = pot.requests.filter((r) => r.kind === "window");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link href={`/pots/${id}`} style={{ fontSize: 15 }}>
          Back to pot {id}
        </Link>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 56, fontWeight: 600, lineHeight: 0.95 }}>Proof of pot {id}</h1>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: C.body, maxWidth: 720 }}>
          The pot contract only moves money on two of three sampler signatures over a window, a price and the hash of the evidence. Each sampler&apos;s average and evidence hash are below; the
          agreed price follows from them by a fixed rule (middle of three, or the mean of two within half a point).
        </p>
      </header>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "8px 20px", fontSize: 16 }}>
        <dt style={{ color: C.muted }}>Contract</dt>
        <dd style={{ margin: 0 }}>
          <a href={addressUrl(POTS)} target="_blank" rel="noreferrer" style={mono}>
            {POTS}
          </a>{" "}
          (HonorCatPots, Arc testnet)
        </dd>
        <dt style={{ color: C.muted }}>Market rule</dt>
        <dd style={{ margin: 0, ...mono }}>{pot.data.conditionId}</dd>
        <dt style={{ color: C.muted }}>Signer set</dt>
        <dd style={{ margin: 0 }}>
          <a href={addressUrl(pot.data.resolver)} target="_blank" rel="noreferrer" style={mono}>
            {pot.data.resolver}
          </a>{" "}
          (two of three)
        </dd>
        {pot.createdTx && (
          <>
            <dt style={{ color: C.muted }}>Created</dt>
            <dd style={{ margin: 0 }}>
              <a href={txUrl(pot.createdTx)} target="_blank" rel="noreferrer" style={mono}>
                {pot.createdTx}
              </a>
            </dd>
          </>
        )}
      </dl>
      <section style={{ display: "flex", flexDirection: "column", gap: 0, borderTop: `1.5px solid ${C.ink}` }}>
        {windows.map((r) => {
          const a = r.payload.attestation;
          return (
            <article key={r.id} style={{ borderBottom: `1px solid ${C.faint}`, padding: "16px 0", display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>
                {KIND_TEXT[r.payload.kind ?? 0]}, {r.payload.windowStart ? formatDate(r.payload.windowStart * 1000) : ""} ({r.payload.windowStart} to {r.payload.windowEnd})
              </h2>
              <p style={{ margin: 0, fontSize: 16 }}>
                {a ? (a.valid ? `Agreed: ${(a.priceYes / 10_000).toFixed(4)}% YES, ${a.sampleCount} readings at least. ${r.payload.reason}.` : `No price: ${r.payload.reason}.`) : `Status: ${r.status}.`}{" "}
                {r.tx && (
                  <a href={txUrl(r.tx)} target="_blank" rel="noreferrer">
                    Transaction
                  </a>
                )}
              </p>
              {a && (
                <p style={{ margin: 0 }}>
                  <span style={{ color: C.muted, fontSize: 14 }}>Evidence root </span>
                  <span style={mono}>{a.evidenceHash}</span>
                </p>
              )}
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {(r.payload.averages ?? []).map((x) => (
                  <li key={x.signer} style={{ fontSize: 14 }}>
                    <span style={mono}>{x.signer}</span>: {x.valid ? `${(Number(x.ppm) / 10_000).toFixed(4)}%` : "not valid"}, {x.sampleCount} valid readings, record <span style={mono}>{x.evidenceHash}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
        {!windows.length && <p style={{ color: C.muted }}>No measured windows yet.</p>}
      </section>
      <RawReadings potId={id} />
      <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Data provided by Gemini.</p>
    </div>
  );
}
