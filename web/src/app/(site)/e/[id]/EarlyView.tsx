"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { CatScale } from "@/components/cat/CatScale";
import { CatHead, Ears, EyesSmall } from "@/components/cat/shapes";
import { STATE_NAMES } from "@/components/cat/StateRail";
import { C, F } from "@/components/cat/tokens";
import { ProbabilityChart } from "@/components/early/ProbabilityChart";
import { useTechMode } from "@/components/TechMode";
import { useWallet, type WalletKind } from "@/lib/wallet/context";
import { WalletChoice } from "@/components/cat/WalletChoice";
import { getJson, usePolling } from "@/lib/api";
import { GeminiCredit, QualityMark, type MarketQuality } from "@/components/cat/Markets";
import { addressUrl, txUrl } from "@/lib/chain";
import { formatDate, formatMoney } from "@/lib/format";
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

export function EarlyTerms({ e }: { e: EarlyDetail["early"] }) {
  const p = e.params;
  const unit = 10 ** p.priceDecimals;
  const what = e.side === "yes" ? `“${e.contractLabel}”` : `not “${e.contractLabel}”`;
  return (
    <details style={{ borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, color: C.body, fontSize: 16, lineHeight: 1.5 }}>
      <summary style={{ cursor: "pointer", fontSize: 18, fontWeight: 600, padding: "12px 0", color: C.ink }}>Full rules</summary>
      <div className="space-y-3" style={{ paddingBottom: 16, maxWidth: 680 }}>
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
          <strong>When.</strong> Joining is open until {formatDate(e.lockTime * 1000)}. From then until trading closes (
          {formatDate(e.tradingClose * 1000)}) the market is watched.
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
        <p style={{ color: C.muted }}>Test version on Arc testnet with test money. This is not insurance and no hedge is placed.</p>
        <p>
          <Link href={`/e/${e.id}/proof`}>See the proof</Link>
          {", "}
          <Link href="/how">how it works</Link>
        </p>
      </div>
    </details>
  );
}

const cond = { fontFamily: F.cond } as const;
const dayAt = (ms: number) => formatDate(ms);

type Row = { name: (typeof STATE_NAMES)[number]; done: boolean; phrase: string };

/** The recipient card's state list: a cat head per state, the latest reached one in signal colour. */
function StateRows({ rows }: { rows: Row[] }) {
  const current = rows.reduce((c, r, i) => (r.done ? i : c), -1);
  return (
    <ol style={{ display: "flex", flexDirection: "column", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, margin: 0, padding: 0, listStyle: "none" }}>
      {rows.map((r, i) => (
        <li
          key={r.name}
          style={{ borderBottom: i < rows.length - 1 ? `1px solid ${C.faint}` : "none", padding: "9px 0", display: "flex", alignItems: "center", gap: 10 }}
        >
          {r.done ? <CatHead width={18} height={17} fill={i === current ? C.signal : C.ink} /> : <CatHead width={18} height={17} outline />}
          <span style={{ fontSize: 17, fontWeight: 600, color: r.done ? C.ink : C.muted, flex: "none" }}>{r.name}</span>
          <span style={{ fontSize: 14, color: C.muted, marginLeft: "auto", textAlign: "right" }}>{r.phrase}</span>
        </li>
      ))}
    </ol>
  );
}

const btn: React.CSSProperties = {
  flex: 1,
  minHeight: 52,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: F.sans,
  fontSize: 18,
  fontWeight: 600,
  textDecoration: "none",
  boxSizing: "border-box",
  border: 0,
  cursor: "pointer",
};
const solid: React.CSSProperties = { ...btn, background: C.ink, color: C.page };
const outline: React.CSSProperties = { ...btn, background: "transparent", color: C.ink, border: `1.5px solid ${C.ink}` };

export function EarlyView() {
  const { id } = useParams<{ id: string }>();
  const { d, error } = useEarly(id);
  const { tech } = useTechMode();
  const [now, setNow] = useState(0);
  const [me, setMe] = useState<PasskeySession | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const wallet = useWallet();
  // The market's order book now (only while the pot is still watching): quality and the live price.
  const open = d ? !["paid", "refunded", "closed", "failed"].includes(d.early.state) : false;
  const { data: quote } = usePolling<{ mid: number | null; quality: MarketQuality | null }>(
    open && d ? `/api/catalog/quote?symbol=${encodeURIComponent(d.early.instrument)}` : null,
    10_000,
  );

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    Promise.resolve().then(() => {
      tick();
      setMe(savedPasskey());
    });
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  if (error && !d) return <p style={{ fontSize: 17, color: C.signalInk }}>{error}</p>;
  if (!d) return <p style={{ fontSize: 17, color: C.muted }}>Loading…</p>;
  const e = d.early;
  const threshold = e.params.thresholdBps / 10_000;
  const latest = [...d.samples].reverse().find((s) => s.status === 0 && s.mid !== null)?.mid ?? null;
  const chance = latest ?? d.market?.chance ?? null;
  // "Me" is the passkey account or, for people who joined with a wallet, the connected wallet.
  const mine = [me?.account, wallet.account].filter(Boolean).map((a) => a!.toLowerCase());
  const joined = d.recipients.some((r) => mine.includes(r.account.toLowerCase()));
  const paidMe = d.payments.find((p) => p.account && mine.includes(p.account.toLowerCase()) && p.kind !== "LeftoverReturned");
  const triggers = d.signatures.filter((s) => s.kind === "trigger");
  const triggerAt = triggers.map((s) => Number((s.record as { windowEnd?: string } | null)?.windowEnd ?? 0)).sort()[1] ?? null;
  const settledMs = d.settledAt ? new Date(d.settledAt).getTime() : null;
  const leadMin = settledMs ? Math.max(0, Math.round((e.tradingClose * 1000 - settledMs) / 60_000)) : null;
  // Measured: from the second independent check (the moment the rule was met twice) to the payment on Arc.
  const toPayS = settledMs && triggerAt ? Math.max(0, (settledMs - triggerAt) / 1000) : null;
  const paid = e.state === "paid";
  const early = paid && e.settledKind === "early";
  const refunded = e.state === "refunded";
  const armed = now > 0 && now >= e.lockTime;
  const what = e.side === "yes" ? `“${e.contractLabel}”` : `“not ${e.contractLabel}”`;
  const spots = Math.max(0, e.maxRecipients - d.recipients.length);
  const lead = leadMin === null ? "" : leadMin >= 120 ? `${Math.round(leadMin / 60)} hours` : `${leadMin} minutes`;

  const title = early ? "Paid early" : paid ? "Paid" : refunded ? "Money returned" : e.state === "triggered" ? "Pouncing" : armed ? "Watching" : "Open to join";
  const sentence = early
    ? `The cat passed the bowl. The market put ${what} above ${pct(threshold)}, so everyone was paid before the result${lead ? `, ${lead} early` : ""}.`
    : paid
      ? "It happened, so everyone got the money."
      : refunded
        ? e.settledKind === "void"
          ? "The market was cancelled. The money went back."
          : `It never got likely enough. The money went back to ${e.name}.`
        : `${headline(e)}. ${e.eventTitle}`;

  const rows: Row[] = [
    { name: "Locked", done: !!e.createdTx, phrase: e.createdTx ? `${formatMoney(e.amount)} each in the vault` : "setting aside the money" },
    { name: "Armed", done: armed || paid || refunded, phrase: armed || paid || refunded ? `ears up, 3 checks every ${e.params.intervalMs / 1000} s` : `ears up on ${dayAt(e.lockTime * 1000)}` },
    { name: "Triggered", done: triggers.length >= 2 || early, phrase: triggers.length >= 2 || early ? "pounce: 2 of 3 agreed" : `waiting for ${pct(threshold)}` },
    { name: "Paid", done: paid, phrase: paid ? "fed, in USDC on Arc" : refunded ? "not paid, money returned" : "not yet" },
    {
      name: "Confirmed",
      done: !!e.record,
      phrase: e.record
        ? e.record.status === "confirmed"
          ? "purr: it really happened"
          : e.record.status === "market_wrong"
            ? "market was wrong, you keep it"
            : "market voided, payout stands"
        : `napping until ${dayAt(e.tradingClose * 1000)}`,
    },
  ];

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

  /** Crypto users: join with any EVM wallet, on any chain. One plain signature, no gas, no network switch. */
  async function joinWithWallet(kind: WalletKind) {
    setJoining(true);
    setJoinError(null);
    try {
      // Use the chosen adapter directly: the context switch below only lands on the next render.
      const ad = kind === "solana" ? wallet.solana : wallet.evm;
      wallet.setKind(kind);
      const account = await ad.connect();
      if (!ad.signMessage) throw new Error("This wallet cannot sign messages.");
      const signature = await ad.signMessage(`Join HonorCat early payout ${id} as ${account}`);
      await post(`/api/early/${id}/join`, { account, signature });
    } catch (err) {
      setJoinError(err instanceof Error ? err.message.split("\n")[0]! : String(err));
    } finally {
      setJoining(false);
    }
  }

  const canJoin = e.state === "locked" && !joined;
  const note = paid
    ? "Nothing to file, nothing to claim. A cat always lands on its feet, and so does your money, even if the market turns out wrong."
    : refunded
      ? "Nobody was paid. The money is back with the person who set it aside."
      : canJoin
        ? `Free to join with a passkey. ${spots} ${spots === 1 ? "spot" : "spots"} left. Ends in ${now ? left(e.tradingClose - now) : "…"}.`
        : `If it pays, the money comes to everyone by itself. Ends in ${now ? left(e.tradingClose - now) : "…"}.`;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "40px 56px", alignItems: "flex-start" }}>
      {/* The recipient card (docs/design/recipient-card.html). */}
      <div style={{ flex: "1 1 340px", maxWidth: 480, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Ears viewBox="0 0 342 30" points={["22,31 54,2 86,31", "256,31 288,2 320,31"]} />
          <div style={{ background: C.ink, color: C.page, padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h1 style={{ margin: 0, ...cond, fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>{title}</h1>
              <EyesSmall />
            </div>
            <span style={{ ...cond, fontSize: "clamp(96px, 30vw, 132px)", fontWeight: 700, lineHeight: 0.92, letterSpacing: "-0.01em" }}>{formatMoney(paidMe?.amount ?? e.amount)}</span>
            <span style={{ fontSize: 15, color: C.faint }}>
              {paid || refunded ? "" : "each, "}from {e.name}
            </span>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.4, color: C.body }}>{sentence}</p>

        <CatScale compact chance={chance} threshold={threshold} />

        <StateRows rows={rows} />

        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: C.muted }}>{note}</p>
        {joined && !paid && <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>You’re in.</p>}
        {paidMe && <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{formatMoney(paidMe.amount)} is yours.</p>}
        {tech && early && toPayS !== null && (
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
            Money moved {toPayS < 90 ? `${toPayS.toFixed(1)} seconds` : `${Math.round(toPayS / 60)} minutes`} after the second independent check saw the rule met.
          </p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          {canJoin ? (
            <button type="button" onClick={join} disabled={joining} style={{ ...solid, opacity: joining ? 0.6 : 1 }}>
              {joining ? "Joining…" : "Join"}
            </button>
          ) : paidMe ? (
            <Link href="/account" style={solid}>
              My money
            </Link>
          ) : null}
          <Link href={`/e/${e.id}/proof`} style={outline}>
            See the proof
          </Link>
        </div>
        {canJoin && (
          <WalletChoice label="Join with a wallet instead" onPick={(k) => void joinWithWallet(k)} busy={joining} />
        )}
        {joinError && <p style={{ margin: 0, fontSize: 14, color: C.signalInk }}>{joinError}</p>}
      </div>

      {/* The chance so far and the rules. */}
      <div style={{ flex: "999 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 28 }}>
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, ...cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>The chance so far</h2>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, color: C.body }}>
            {e.eventTitle}. Pays when the market holds {what} at {pct(threshold)} or more.
          </p>
          <span style={{ fontFamily: F.mono, fontSize: 13, color: C.muted, overflowWrap: "anywhere" }}>Gemini · {e.instrument}</span>
          <ProbabilityChart samples={d.samples} threshold={threshold} windowMs={e.params.windowMs} armedAt={e.lockTime * 1000} triggeredAt={triggerAt} />
          <span style={{ fontSize: 14, color: C.muted }}>
            {d.samples.length
              ? "Each reading is the middle of Gemini’s best buy and sell price, as the independent checks recorded it."
              : armed
                ? "Waiting for the first reading."
                : `Readings start when joining closes, ${dayAt(e.lockTime * 1000)}.`}
            {" "}Averaged across the checks every 5 seconds.
          </span>
          {open && (
            <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center", fontSize: 14, color: C.muted }}>
              Market quality now: <QualityMark q={quote?.quality ?? null} small />
              {quote?.quality && quote.quality.reasons.length > 0 && <span>{quote.quality.reasons.join("; ")}</span>}
            </span>
          )}
          <GeminiCredit />

        </section>

        <EarlyTerms e={e} />

        {tech && (
          <details open style={{ borderBottom: `1.5px solid ${C.ink}`, fontSize: 14, color: C.body }}>
            <summary style={{ cursor: "pointer", fontSize: 18, fontWeight: 600, padding: "0 0 12px", color: C.ink }}>Under the hood</summary>
            <dl className="space-y-1.5 break-all" style={{ margin: 0, paddingBottom: 16 }}>
              <div>
                Gemini contract: <span className="mono">{e.instrument}</span> ({e.side.toUpperCase()} side)
              </div>
              <div>
                Rule: threshold {e.params.thresholdBps / 100}%, window {e.params.windowMs / 1000} s, a sample every {e.params.intervalMs / 1000} s, at least {e.params.minValidSamples}{" "}
                valid, spread at most {e.params.maxSpreadUnits} units, size at least {e.params.minSizeUnits} units, data at most {e.params.maxStalenessMs / 1000} s old ({e.template})
              </div>
              <div>
                conditionId (commits to the rule): <span className="mono">{e.conditionId}</span>
              </div>
              <div>
                Resolver (2 of 3 samplers):{" "}
                <a className="mono" href={addressUrl(e.resolver)} target="_blank" rel="noreferrer">
                  {e.resolver}
                </a>
              </div>
              {e.potId && (
                <div>
                  Pot #{e.potId}{" "}
                  {e.createdTx && (
                    <a className="mono" href={txUrl(e.createdTx)} target="_blank" rel="noreferrer">
                      {e.createdTx.slice(0, 12)}…
                    </a>
                  )}
                </div>
              )}
              {e.settledTx?.startsWith("0x") && (
                <div>
                  Settled ({e.settledKind}):{" "}
                  <a className="mono" href={txUrl(e.settledTx)} target="_blank" rel="noreferrer">
                    {e.settledTx.slice(0, 12)}…
                  </a>
                </div>
              )}
              {e.evidenceRoot && (
                <div>
                  evidenceRoot (in the payout memo): <span className="mono">{e.evidenceRoot}</span>
                </div>
              )}
              <div>Signed results: {d.signatures.length ? d.signatures.map((s) => `${s.kind} by ${s.signer.slice(0, 8)}…`).join(", ") : "none yet"}</div>
            </dl>
          </details>
        )}
      </div>
    </div>
  );
}
