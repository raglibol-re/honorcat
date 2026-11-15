"use client";

/* eslint-disable @next/next/no-img-element -- Gemini's own event artwork, served from assets.gemini.com */

import { useMemo, useRef, useState } from "react";

export type PickerContract = { ticker: string; label: string; chanceYes: number | null };
export type PickerMarket = {
  ticker: string;
  title: string;
  category: string;
  subcategory: string | null;
  image: string | null;
  volume: number | null;
  expiry: string;
  contracts: PickerContract[];
};

type Sort = "soon" | "traded";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

function settlesIn(expiry: string, now: number) {
  const s = Math.max(0, Math.round((new Date(expiry).getTime() - now) / 1000));
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 48 * 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return `in ${h} h${m ? ` ${m} min` : ""}`;
  }
  return `in ${Math.round(s / 86400)} days`;
}

const settlesAt = (expiry: string) =>
  new Date(expiry).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const traded = (v: number | null) =>
  v === null || v <= 0 ? null : `$${v >= 1000 ? `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : Math.round(v)} traded`;

/** The likeliest threshold, shown on each card so a market can be read at a glance. */
const leading = (m: PickerMarket) =>
  m.contracts.reduce<PickerContract | null>((best, c) => (c.chanceYes !== null && (best?.chanceYes ?? -1) < c.chanceYes ? c : best), null);

function Art({ m, className }: { m: PickerMarket; className: string }) {
  const [failed, setFailed] = useState(false);
  if (m.image && !failed) {
    return <img src={m.image} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className={`${className} object-cover`} />;
  }
  const initials = (m.subcategory ?? m.title).replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  return (
    <div aria-hidden className={`${className} t-17 flex items-center justify-center font-semibold`} style={{ background: "var(--vg-accent-soft)", color: "var(--vg-accent)" }}>
      {initials || "•"}
    </div>
  );
}

function ChanceBar({ value }: { value: number | null }) {
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden" style={{ background: "var(--vg-rule)" }}>
      <span className="block h-full" style={{ width: `${Math.round((value ?? 0) * 100)}%`, background: "var(--vg-accent)" }} />
    </span>
  );
}

/**
 * Market selection: a compact summary of the chosen market that opens a sheet with every live
 * Gemini market for the template, as picture cards (Gemini's own artwork), searchable and
 * sortable. Picking a card shows its thresholds with the market's current chance for each.
 */
export function MarketPicker(p: {
  markets: PickerMarket[];
  market: PickerMarket | null;
  contract: PickerContract | null;
  onPick: (marketTicker: string, contractIndex: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("soon");
  const [open, setOpen] = useState<string | null>(null); // market shown in detail
  const [now, setNow] = useState(0);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const xs = p.markets.filter((m) => !q || `${m.title} ${m.subcategory ?? ""} ${m.contracts.map((c) => c.label).join(" ")}`.toLowerCase().includes(q));
    return sort === "soon" ? xs : [...xs].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  }, [p.markets, query, sort]);
  const detail = p.markets.find((m) => m.ticker === open) ?? null;

  const show = () => {
    setNow(Date.now());
    setOpen(null);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="vg-ticket flex w-full items-center gap-3 px-3 py-3 text-left"
        aria-haspopup="dialog"
      >
        {p.market ? (
          <>
            <Art m={p.market} className="h-14 w-14 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="t-15 line-clamp-2 block font-medium">{p.market.title}</span>
              <span className="t-13 block" style={{ color: "var(--vg-muted)" }}>
                {p.contract
                  ? `${p.contract.label}${p.contract.chanceYes === null ? " (no trades yet)" : `, ${pct(p.contract.chanceYes)} chance`}`
                  : "Choose a threshold"}
              </span>
              <span className="t-13 block" style={{ color: "var(--vg-muted)" }}>
                Settles {settlesAt(p.market.expiry)}
              </span>
            </span>
            <span className="t-13 shrink-0 font-medium" style={{ color: "var(--vg-accent)" }}>
              Change
            </span>
          </>
        ) : (
          <span className="t-15 font-medium">Choose a market ({p.markets.length} live)</span>
        )}
      </button>

      <dialog
        ref={dialog}
        aria-label="Choose a market"
        onClick={(e) => e.target === dialog.current && close()}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none p-0 backdrop:bg-black/50 sm:m-auto sm:h-[85vh] sm:w-[min(48rem,calc(100vw-2rem))] sm:"
        style={{ background: "var(--vg-page)", color: "var(--vg-ink)" }}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}>
            {detail && (
              <button type="button" onClick={() => setOpen(null)} className="t-15 px-2 py-1" aria-label="Back to all markets">
                ‹ All
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="t-17 truncate font-medium">{detail ? detail.title : "Choose a market"}</h2>
              <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                {detail ? `Settles ${settlesAt(detail.expiry)}` : `${list.length} live on Gemini. Chances are market estimates.`}
              </p>
            </div>
            <button type="button" onClick={close} className="t-21 h-9 w-9" aria-label="Close">
              ×
            </button>
          </header>

          {!detail && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search city, coin or threshold"
                className="t-15 min-w-0 flex-1 border px-3 py-2"
                style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}
              />
              <div className="t-13 flex border p-0.5" role="radiogroup" aria-label="Sort" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}>
                {(
                  [
                    ["soon", "Settles soonest"],
                    ["traded", "Most traded"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={sort === k}
                    onClick={() => setSort(k)}
                    className="px-2.5 py-1.5"
                    style={sort === k ? { background: "var(--vg-accent-soft)", color: "var(--vg-accent)" } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {!detail && list.length === 0 && (
              <p className="t-15 py-8 text-center" style={{ color: "var(--vg-muted)" }}>
                No market matches &ldquo;{query}&rdquo;.
              </p>
            )}

            {!detail && (
              <ul className="grid gap-3 sm:grid-cols-2">
                {list.map((m) => {
                  const lead = leading(m);
                  const selected = p.market?.ticker === m.ticker;
                  return (
                    <li key={m.ticker}>
                      <button
                        type="button"
                        onClick={() => {
                          if (m.contracts.length > 1) return setOpen(m.ticker);
                          p.onPick(m.ticker, 0);
                          close();
                        }}
                        className="vg-ticket flex w-full items-start gap-3 p-3 text-left"
                        style={selected ? { borderColor: "var(--vg-accent)", boxShadow: "0 0 0 1px var(--vg-accent)" } : undefined}
                      >
                        <Art m={m} className="h-16 w-16 shrink-0" />
                        <span className="block min-w-0 flex-1 space-y-1.5">
                          <span className="t-15 block font-medium leading-snug">{m.title}</span>
                          <span className="t-13 flex flex-wrap gap-x-3" style={{ color: "var(--vg-muted)" }}>
                            <span>Settles {settlesIn(m.expiry, now)}</span>
                            <span>{m.contracts.length} {m.contracts.length === 1 ? "outcome" : "thresholds"}</span>
                            {traded(m.volume) && <span>{traded(m.volume)}</span>}
                          </span>
                          {lead ? (
                            <span className="block space-y-1">
                              <span className="t-13 flex justify-between gap-2">
                                <span className="truncate">Most likely: {lead.label}</span>
                                <span className="mono">{pct(lead.chanceYes)}</span>
                              </span>
                              <ChanceBar value={lead.chanceYes} />
                            </span>
                          ) : (
                            <span className="t-13 block" style={{ color: "var(--vg-muted)" }}>
                              No trades yet, so no market estimate
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {detail && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Art m={detail} className="h-20 w-20 shrink-0" />
                  <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                    Pick the threshold your promise depends on. Next, you choose whether customers are refunded if it happens or if it does not.
                    {traded(detail.volume) ? ` ${traded(detail.volume)} on Gemini.` : ""}
                  </p>
                </div>
                <ul className="space-y-2">
                  {detail.contracts.map((c, i) => {
                    const selected = p.market?.ticker === detail.ticker && p.contract?.ticker === c.ticker;
                    return (
                      <li key={c.ticker}>
                        <button
                          type="button"
                          onClick={() => {
                            p.onPick(detail.ticker, i);
                            close();
                          }}
                          className="vg-ticket block w-full space-y-1.5 px-4 py-3 text-left"
                          style={selected ? { borderColor: "var(--vg-accent)", boxShadow: "0 0 0 1px var(--vg-accent)" } : undefined}
                        >
                          <span className="t-15 flex justify-between gap-3">
                            <span>{c.label}</span>
                            {c.chanceYes === null ? (
                              <span className="t-13" style={{ color: "var(--vg-muted)" }}>
                                no trades yet
                              </span>
                            ) : (
                              <span className="mono">{pct(c.chanceYes)} chance</span>
                            )}
                          </span>
                          {c.chanceYes !== null && <ChanceBar value={c.chanceYes} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
