"use client";

import { useState } from "react";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { C, F } from "@/components/cat/tokens";
import { btnQuiet } from "@/components/pot/Who";
import { getJson } from "@/lib/api";
import { potEvidenceMessage } from "@/lib/evidence";
import { short } from "@/lib/format";
import { joinChallenge, savedPasskey, signChallenge } from "@/lib/passkey";
import { useWallet } from "@/lib/wallet/context";

type Sample = { t: string | number; bid?: string; ask?: string; bidSize?: string; askSize?: string; status: string | number };
type Rec = { request_id: string; signer: string; evidence_hash: string; record: { windowStart?: string; windowEnd?: string; samples?: Sample[]; averageMicro?: string; params?: { priceDecimals?: string; sizeDecimals?: string } } };

const STATUS = ["ok", "no data", "stale", "crossed", "wide spread", "thin bid", "thin ask", "off tick"];
const post = <T,>(path: string, body: unknown) => getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Every sampler's raw readings, for the pot's sides after one signature (Gemini's data terms). */
export function RawReadings({ potId }: { potId: string }) {
  const wallet = useWallet();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async (body: Record<string, unknown>) => {
    const s = await post<{ token: string }>(`/api/hc/pots/${potId}/evidence/session`, body);
    const r = await getJson<{ records: Rec[] }>(`/api/hc/pots/${potId}/evidence`, { headers: { authorization: `Bearer ${s.token}` } });
    setRecs(r.records);
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]!);
    } finally {
      setBusy(false);
    }
  };

  if (recs)
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>Raw readings</h2>
        {recs.map((r) => {
          const dec = Number(r.record.params?.priceDecimals ?? 2);
          const unit = 10 ** dec;
          const sizeUnit = 10 ** Number(r.record.params?.sizeDecimals ?? 2);
          const samples = r.record.samples ?? [];
          return (
            <details key={`${r.request_id}:${r.signer}`} style={{ borderTop: `1px solid ${C.faint}`, padding: "8px 0" }}>
              <summary style={{ cursor: "pointer", fontSize: 15 }}>
                {r.request_id} · sampler {short(r.signer)} · {samples.length} readings · average{" "}
                {r.record.averageMicro ? `${(Number(r.record.averageMicro) / 10 ** (dec + 6) * 100).toFixed(2)}%` : "–"}
              </summary>
              <table style={{ borderCollapse: "collapse", fontFamily: F.mono, fontSize: 12, marginTop: 6 }}>
                <thead>
                  <tr>
                    {["time", "bid", "ask", "bid size", "ask size", "status"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "2px 10px 2px 0", color: C.muted, fontWeight: 500 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s, i) => (
                    <tr key={i}>
                      <td style={{ padding: "1px 10px 1px 0" }}>{new Date(Number(s.t)).toISOString().slice(11, 19)}</td>
                      <td style={{ padding: "1px 10px 1px 0" }}>{s.bid ? (Number(s.bid) / unit).toFixed(dec) : "–"}</td>
                      <td style={{ padding: "1px 10px 1px 0" }}>{s.ask ? (Number(s.ask) / unit).toFixed(dec) : "–"}</td>
                      <td style={{ padding: "1px 10px 1px 0" }}>{s.bidSize ? Number(s.bidSize) / sizeUnit : "–"}</td>
                      <td style={{ padding: "1px 10px 1px 0" }}>{s.askSize ? Number(s.askSize) / sizeUnit : "–"}</td>
                      <td style={{ padding: "1px 10px 1px 0" }}>{STATUS[Number(s.status)] ?? s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          );
        })}
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Data provided by Gemini. For the sides of this pot only; please do not pass it on.</p>
      </section>
    );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>Raw readings</h2>
      <p style={{ margin: 0, fontSize: 16, color: C.body, maxWidth: 720 }}>
        Every bid, ask and size each sampler read is Gemini market data, so it is shown to the sides of this pot only. Sign once to see it; the hashes above let anyone else check it.
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          style={btnQuiet}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const s = savedPasskey();
              if (!s) throw new Error("No passkey on this device. Use the wallet you played with.");
              const issuedAt = new Date().toISOString();
              const passkey = await signChallenge(s, await joinChallenge(potEvidenceMessage(potId, s.account, issuedAt)));
              await open({ account: s.account, issuedAt, passkey });
            })
          }
        >
          Show with my passkey
        </button>
        <WalletChoice
          label="or with a wallet"
          busy={busy}
          onPick={(k) =>
            run(async () => {
              const ad = k === "solana" ? wallet.solana : wallet.evm;
              wallet.setKind(k);
              const account = await ad.connect();
              if (!ad.signMessage) throw new Error("This wallet cannot sign messages.");
              const issuedAt = new Date().toISOString();
              await open({ account, issuedAt, signature: await ad.signMessage(potEvidenceMessage(potId, account, issuedAt)) });
            })
          }
        />
      </div>
      {err && (
        <p role="alert" style={{ margin: 0, color: C.signalInk }}>
          {err}
        </p>
      )}
    </section>
  );
}
