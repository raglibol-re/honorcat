"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { ProbabilityChart } from "@/components/early/ProbabilityChart";
import { useTechMode } from "@/components/TechMode";
import { getJson } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { formatMoney } from "@/lib/format";
import { createPasskey, joinChallenge, passkeysSupported, savedPasskey, signChallenge, type PasskeySession } from "@/lib/passkey";

type Params = { thresholdBps: number; windowMs: number; intervalMs: number; minValidSamples: number; maxSpreadUnits: number; minSizeUnits: number; maxStalenessMs: number; priceDecimals: number; sizeDecimals: number };
export type EarlyDetail = {
  early: {
    id: string;
    potId: string | null;
    name: string;
    funder: Address;
    eventTicker: string;
    contractTicker: string;
    instrument: string;
    side: "yes" | "no";
    mode: "early-only" | "early-or-outcome";
    template: string;
    params: Params;
    amount: string;
    maxRecipients: number;
    lockTime: number;
    tradingClose: number;
    deadline: number;
    eventTitle: string;
    contractLabel: string;
    promise: string;
    conditionId: string;
    resolver: Address;
    createdTx: string | null;
    state: "locked" | "armed" | "triggered" | "paid" | "refunded" | "closed" | "failed" | "pending";
    settledKind: string | null;
    settledTx: string | null;
    evidenceRoot: string | null;
    record: { occurred: boolean | null; status: string; tx: string | null; at: string | null } | null;
  };
  signatures: { signer: Address; kind: string; outcome: boolean; evidenceHash: string | null; record: Record<string, unknown> | null; at: string }[];
  recipients: { account: Address; seat: number; tx: string }[];
  payments: { account: Address | null; amount: string; tx: string; kind: string }[];
  samples: { signer: string; t: number; mid: number | null; status: number }[];
  settledAt: string | null;
  market: { chance: number | null; status: string; marketState: string | null; resolutionSide: string | null; image: string | null } | null;
};

const post = <T,>(path: string, body: unknown) => getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(d)}%`);

function left(s: number) {
  if (s <= 0) return "ended";
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  if (s < 172_800) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} days`;
}

/** "Paid when “46°F to 47°F” hits 85%": the promise in a few words; the event title goes below. */
export function headline(e: Pick<EarlyDetail["early"], "side" | "contractLabel" | "params">) {
  const what = e.side === "yes" ? `“${e.contractLabel}”` : `“not ${e.contractLabel}”`;
  return `Paid when ${what} hits ${e.params.thresholdBps / 100}%`;
}

export function useEarly(id: string) {
  const [d, setD] = useState<EarlyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      getJson<EarlyDetail>(`/api/early/${id}`)
        .then((x) => !stop && (setD(x), setError(null)))
        .catch((e) => !stop && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);
  return { d, error };
}

/** Money in → Watching → Paid, from indexed facts. */
function Rail({ d, now }: { d: EarlyDetail; now: number }) {
  const e = d.early;
  const steps = [
    { label: "Money in", done: !!e.createdTx },
    { label: "Watching", done: now >= e.lockTime },
    { label: e.state === "refunded" ? "Returned" : "Paid", done: e.state === "paid" || e.state === "refunded" },
  ];
  return (
    <ol className="grid grid-cols-3 gap-1" aria-label="Progress">
      {steps.map((s) => (
        <li key={s.label} className="min-w-0">
          <span className="block h-1.5 rounded-full" style={{ background: s.done ? "var(--vg-accent)" : "var(--vg-rule)" }} />
          <span className="t-13 mt-1 block" style={{ color: s.done ? "var(--vg-ink)" : "var(--vg-muted)" }}>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function EarlyTerms({ e }: { e: EarlyDetail["early"] }) {
  const p = e.params;
  const unit = 10 ** p.priceDecimals;
  const what = e.side === "yes" ? `“${e.contractLabel}”` : `not “${e.contractLabel}”`;
  return (
    <details className="t-15 px-1" style={{ color: "var(--vg-muted)" }}>
      <summary className="t-15 cursor-pointer font-medium">Full rules</summary>
      <div className="t-15 mt-3 space-y-3">
        <p>
          <strong>What pays.</strong> {e.name} has set aside {formatMoney(e.amount)} for each person on this list. Everyone is paid at once,
          automatically, as soon as the Gemini market for “{e.eventTitle.replace(/\?$/, "")}” gives {what} a {p.thresholdBps / 100}% chance or more.
          Nothing to file, claim or prove.
        </p>
        <p>
          <strong>The exact rule.</strong> Three independent samplers read Gemini’s public order book every {p.intervalMs / 1000} seconds. A
          reading counts only if the gap between the best buy and sell price is at most {p.maxSpreadUnits / unit} USD, both sides offer at least{" "}
          {p.minSizeUnits / 10 ** p.sizeDecimals} contracts, and the data is no older than {p.maxStalenessMs / 1000} seconds. The chance is the
          middle of the best buy and sell price. It must average {p.thresholdBps / 100}% or more over {p.windowMs >= 60_000 ? `${p.windowMs / 60_000} minute${p.windowMs === 60_000 ? "" : "s"}` : `${p.windowMs / 1000} seconds`}, from at
          least {p.minValidSamples} valid readings, with fresh data at the end. Two of the three samplers must each see this in their own data.
          A single price spike never pays. These numbers are fixed when the money is set aside and cannot change afterwards.
        </p>
        <p>
          <strong>When.</strong> Joining is open until {new Date(e.lockTime * 1000).toLocaleString()}. From then until trading closes (
          {new Date(e.tradingClose * 1000).toLocaleString()}) the market is watched.
        </p>
        <p>
          <strong>If it never gets there.</strong>{" "}
          {e.mode === "early-only"
            ? "If the chance does not reach the threshold before trading closes, nobody is paid and the money goes back to the funder at trading close, without waiting for the result."
            : "If the chance does not reach the threshold before trading closes, everyone is still paid when the market settles if the event happened. If it did not happen, the money goes back to the funder. If there is no result by the deadline plus a grace period, the money goes back to the funder."}
        </p>
        <p>
          <strong>Bad or missing data never pays.</strong> Readings with a wide gap, a thin book or old data do not count. If the market data
          stops, there is no payout from that period; an outage that lasts until trading closes counts as “not reached”. While Gemini reviews
          the market, nothing can pay early.
        </p>
        <p>
          <strong>If the market is voided.</strong> Before an early payout: the funder gets everything back. After an early payout: the payout
          stands and the page says “market voided”.
        </p>
        <p>
          <strong>An early payout is final.</strong> The market can be wrong. If the event later does not happen, nobody has to pay anything
          back; the page records “market was wrong”.
        </p>
        <p>
          <strong>If your account cannot receive money.</strong> Everyone else is paid. Your amount stays reserved for you and you can collect
          it later; it does not go back to the funder.
        </p>
        <p style={{ color: "var(--vg-muted)" }}>Test version on Arc testnet with test money. This is not insurance and no hedge is placed.</p>
        <p>
          <Link href={`/e/${e.id}/proof`} className="underline underline-offset-4">
            See the proof
          </Link>{" "}
          ·{" "}
          <Link href="/how" className="underline underline-offset-4">
            How it works
          </Link>
        </p>
      </div>
    </details>
  );
}

export function EarlyView() {
  const { id } = useParams<{ id: string }>();
  const { d, error } = useEarly(id);
  const { tech } = useTechMode();
  const [now, setNow] = useState(0);
  const [me, setMe] = useState<PasskeySession | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    Promise.resolve().then(() => {
      tick();
      setMe(savedPasskey());
    });
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  if (error && !d) return <p className="t-15" style={{ color: "var(--negative)" }}>{error}</p>;
  if (!d) return <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>;
  const e = d.early;
  const threshold = e.params.thresholdBps / 10_000;
  const latest = [...d.samples].reverse().find((s) => s.status === 0 && s.mid !== null)?.mid ?? null;
  const joined = me ? d.recipients.some((r) => r.account.toLowerCase() === me.account.toLowerCase()) : false;
  const paidMe = me ? d.payments.find((p) => p.account?.toLowerCase() === me.account.toLowerCase() && p.kind !== "LeftoverReturned") : undefined;
  const triggerAt = d.signatures.filter((s) => s.kind === "trigger").map((s) => Number((s.record as { windowEnd?: string } | null)?.windowEnd ?? 0)).sort()[1] ?? null;
  const settledMs = d.settledAt ? new Date(d.settledAt).getTime() : null;
  const leadMin = settledMs ? Math.max(0, Math.round((e.tradingClose * 1000 - settledMs) / 60_000)) : null;
  // Measured: from the second independent check (the moment the rule was met twice) to the payment on Arc.
  const toPayS = settledMs && triggerAt ? Math.max(0, (settledMs - triggerAt) / 1000) : null;

  async function join() {
    setJoining(true);
    setJoinError(null);
    try {
      if (!passkeysSupported()) throw new Error("This browser does not support passkeys.");
      const session = me ?? (await createPasskey());
      const assertion = await signChallenge(session, await joinChallenge(`Join HonorCat early payout ${id} as ${session.account}`));
      await post(`/api/early/${id}/join`, { account: session.account, passkey: assertion });
      setMe(session);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="vg-ticket space-y-4 px-5 py-5">
        <div>
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            From {e.name}
          </p>
          <h1 className="t-21 mt-1 font-semibold leading-snug">{headline(e)}</h1>
          <p className="t-15 mt-1" style={{ color: "var(--vg-muted)" }}>
            {e.eventTitle}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="t-13" style={{ color: "var(--vg-muted)" }}>
              You get
            </dt>
            <dd className="mono t-21 font-medium">{formatMoney(e.amount)}</dd>
          </div>
          <div>
            <dt className="t-13" style={{ color: "var(--vg-muted)" }}>
              Chance now
            </dt>
            <dd className="mono t-21 font-medium">{pct(latest ?? d.market?.chance)}</dd>
            <dd className="t-13" style={{ color: "var(--vg-muted)" }}>
              pays at {pct(threshold)}
            </dd>
          </div>
          <div>
            <dt className="t-13" style={{ color: "var(--vg-muted)" }}>
              Ends in
            </dt>
            <dd className="mono t-21 font-medium">{now ? left(e.tradingClose - now) : "…"}</dd>
          </div>
        </dl>
        <Rail d={d} now={now} />
      </section>

      {/* outcome */}
      {e.state === "paid" && (
        <section className="vg-ticket space-y-1 px-5 py-4" style={{ borderColor: "var(--vg-accent)" }}>
          <p className="t-17 font-semibold">{e.settledKind === "early" ? "Paid early" : "Paid"}</p>
          <p className="t-15">
            {e.settledKind === "early"
              ? `Everyone got the money${leadMin !== null ? `, ${leadMin >= 120 ? `${Math.round(leadMin / 60)} hours` : `${leadMin} minutes`} early` : ""}.`
              : "It happened, so everyone got the money."}
          </p>
          {tech && e.settledKind === "early" && toPayS !== null && (
            <p className="t-13" style={{ color: "var(--vg-muted)" }}>
              Money moved {toPayS < 90 ? `${toPayS.toFixed(1)} seconds` : `${Math.round(toPayS / 60)} minutes`} after the second independent check saw the rule met.
            </p>
          )}
          {e.record && (
            <p className="t-15">
              {e.record.status === "confirmed" ? "And it really happened." : e.record.status === "market_wrong" ? "It did not happen after all. You keep the money." : "The market was cancelled later. You keep the money."}
            </p>
          )}
        </section>
      )}
      {e.state === "refunded" && (
        <section className="vg-ticket px-5 py-4">
          <p className="t-17 font-semibold">No payout this time</p>
          <p className="t-15" style={{ color: "var(--vg-muted)" }}>
            {e.settledKind === "void" ? "The market was cancelled. The money went back." : "It never got likely enough. The money went back."}
          </p>
        </section>
      )}

      {/* join */}
      {e.state === "locked" && !joined && (
        <section className="vg-ticket space-y-2 px-5 py-4">
          <button type="button" onClick={join} disabled={joining} className="t-17 w-full rounded-xl px-4 py-3.5 font-medium disabled:opacity-60" style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}>
            {joining ? "Joining…" : "Join"}
          </button>
          <p className="t-13 text-center" style={{ color: "var(--vg-muted)" }}>
            Free. {Math.max(0, e.maxRecipients - d.recipients.length)} spots left.
          </p>
          {joinError && (
            <p className="t-13" style={{ color: "var(--negative)" }}>
              {joinError}
            </p>
          )}
        </section>
      )}
      {joined && (
        <section className="vg-ticket px-5 py-4">
          <p className="t-15 font-medium">{paidMe ? `${formatMoney(paidMe.amount)} is yours.` : "You’re in."}</p>
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            {paidMe ? (
              <>
                See it in <Link className="underline" href="/account">My money</Link>.
              </>
            ) : (
              "If it pays, the money comes to you by itself."
            )}
          </p>
        </section>
      )}

      <section className="vg-ticket space-y-2 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="t-15 font-medium">Chance</h2>
          {tech && (
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              thin: each independent check · thick: the average that decides · dashed: {pct(threshold)}
            </span>
          )}
        </div>
        <ProbabilityChart samples={d.samples} threshold={threshold} windowMs={e.params.windowMs} armedAt={e.lockTime * 1000} triggeredAt={triggerAt} />
      </section>

      <EarlyTerms e={e} />

      {tech && (
      <details className="vg-ticket px-5 py-4" open>
        <summary className="t-15 cursor-pointer font-medium">Under the hood</summary>
        <dl className="t-13 mt-3 space-y-1.5 break-all">
          <div>
            Gemini contract: <span className="mono">{e.instrument}</span> ({e.side.toUpperCase()} side)
          </div>
          <div>
            Rule: threshold {e.params.thresholdBps / 100}%, window {e.params.windowMs / 1000} s, a sample every {e.params.intervalMs / 1000} s, ≥ {e.params.minValidSamples} valid,
            spread ≤ {e.params.maxSpreadUnits} units, size ≥ {e.params.minSizeUnits} units, data ≤ {e.params.maxStalenessMs / 1000} s old (provisional; {e.template})
          </div>
          <div>
            conditionId (commits to the rule): <span className="mono">{e.conditionId}</span>
          </div>
          <div>
            Resolver (2 of 3 samplers):{" "}
            <a className="mono hover:underline" href={addressUrl(e.resolver)} target="_blank" rel="noreferrer">
              {e.resolver}
            </a>
          </div>
          {e.potId && <div>Pot #{e.potId} {e.createdTx && <a className="mono hover:underline" href={txUrl(e.createdTx)} target="_blank" rel="noreferrer">{e.createdTx.slice(0, 12)}…</a>}</div>}
          {e.settledTx?.startsWith("0x") && (
            <div>
              Settled ({e.settledKind}): <a className="mono hover:underline" href={txUrl(e.settledTx)} target="_blank" rel="noreferrer">{e.settledTx.slice(0, 12)}…</a>
            </div>
          )}
          {e.evidenceRoot && <div>evidenceRoot (in the payout memo): <span className="mono">{e.evidenceRoot}</span></div>}
          <div>
            Signed results: {d.signatures.length ? d.signatures.map((s) => `${s.kind} by ${s.signer.slice(0, 8)}…`).join(", ") : "none yet"}
          </div>
        </dl>
        <Link href={`/e/${e.id}/proof`} className="t-15 mt-3 inline-block underline underline-offset-4">
          Public proof: every sample, signature and how to check them
        </Link>
      </details>
      )}
    </div>
  );
}
