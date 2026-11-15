"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { Hex, TypedDataDefinition } from "viem";
import { getJson, usePolling } from "@/lib/api";
import { useWallet } from "@/lib/wallet/context";
import { formatClock } from "@/lib/format";
import { MarketPicker } from "@/components/guarantee/MarketPicker";

type Template = "rate" | "temperature" | "price" | "demo";
type Contract = { ticker: string; label: string; status: string; chanceYes: number | null; askYes: number | null; askNo: number | null };
type Market = {
  ticker: string;
  title: string;
  category: string;
  subcategory: string | null;
  image: string | null;
  volume: number | null;
  expiry: string;
  contracts: Contract[];
};
type MarketsResponse = { template: Template; info: { title: string; blurb: string }; markets: Market[]; fetchedAt: string };

const TEMPLATES: { key: Template; title: string; blurb: string }[] = [
  { key: "rate", title: "Rate guarantee", blurb: "Fed decision at a specific meeting" },
  { key: "temperature", title: "Temperature guarantee", blurb: "A city's daily high" },
  { key: "price", title: "Price guarantee", blurb: "Crypto or commodity price threshold" },
  { key: "demo", title: "5-minute crypto", blurb: "Gemini up/down market, settles in minutes" },
];

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const usd = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function NewGuarantee() {
  const [template, setTemplate] = useState<Template>("temperature");
  const { data, error } = usePolling<MarketsResponse>(`/api/markets?template=${template}`, 15_000);
  const markets = data?.template === template ? data.markets : null;

  const [marketTicker, setMarketTicker] = useState<string | null>(null);
  const [contractIdx, setContractIdx] = useState(0);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [merchantName, setMerchantName] = useState("");
  const [refund, setRefund] = useState("5.00");
  const [seats, setSeats] = useState(20);

  // Derived selection: default to the first market until the merchant picks one.
  const market = markets?.find((m) => m.ticker === marketTicker) ?? markets?.[0] ?? null;
  const contracts = market?.contracts ?? [];
  const contract = contracts[Math.min(contractIdx, Math.max(0, contracts.length - 1))] ?? null;

  const refundNum = Number(refund) || 0;
  const worstCase = refundNum * seats;
  const chanceYes = contract?.chanceYes ?? null;
  const chance = chanceYes === null ? null : side === "yes" ? chanceYes : 1 - chanceYes;
  const expected = chance === null ? null : chance * worstCase;
  const hedgePrice = contract ? (side === "yes" ? contract.askYes : contract.askNo) : null;

  const pick = (t: Template) => {
    setTemplate(t);
    setMarketTicker(null);
    setContractIdx(0);
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-8">
        {/* ---------------------------------------------------------------- template */}
        <section>
          <h2 className="t-17 font-medium">What should the refund depend on?</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Template">
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={template === t.key}
                onClick={() => pick(t.key)}
                className="vg-ticket px-4 py-3 text-left"
                style={template === t.key ? { borderColor: "var(--vg-accent)", boxShadow: "0 0 0 1px var(--vg-accent)" } : undefined}
              >
                <span className="t-15 block font-medium">{t.title}</span>
                <span className="t-13 block" style={{ color: "var(--vg-muted)" }}>
                  {t.blurb}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- market */}
        <section>
          <h2 className="t-17 font-medium">Live market</h2>
          {error && !markets && (
            <p className="t-15 mt-2" style={{ color: "var(--negative)" }}>
              {error}
            </p>
          )}
          {!markets && !error && (
            <p className="t-15 mt-2" style={{ color: "var(--vg-muted)" }}>
              Loading markets from Gemini…
            </p>
          )}
          {markets && markets.length === 0 && (
            <p className="t-15 mt-2 rounded-xl border px-4 py-3" style={{ borderColor: "var(--vg-rule)" }}>
              Gemini has no active market for this template right now. Try another template or check back later.
            </p>
          )}
          {markets && markets.length > 0 && market && (
            <div className="mt-3 space-y-4">
              <MarketPicker
                markets={markets}
                market={market}
                contract={contract}
                onPick={(ticker, i) => {
                  setMarketTicker(ticker);
                  setContractIdx(i);
                }}
              />

              {contracts.length > 1 && (
                <div>
                  <span className="t-13" style={{ color: "var(--vg-muted)" }}>
                    Threshold
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Previous threshold"
                      disabled={contractIdx === 0}
                      onClick={() => setContractIdx((i) => Math.max(0, i - 1))}
                      className="t-17 h-10 w-10 shrink-0 rounded-lg border disabled:opacity-40"
                      style={{ borderColor: "var(--vg-rule)" }}
                    >
                      ‹
                    </button>
                    <div className="t-15 flex-1 rounded-lg border px-3 py-2 text-center" style={{ borderColor: "var(--vg-rule)" }}>
                      {contract?.label} <span className="mono t-13" style={{ color: "var(--vg-muted)" }}>({pct(contract?.chanceYes ?? null)} yes)</span>
                    </div>
                    <button
                      type="button"
                      aria-label="Next threshold"
                      disabled={contractIdx >= contracts.length - 1}
                      onClick={() => setContractIdx((i) => Math.min(contracts.length - 1, i + 1))}
                      className="t-17 h-10 w-10 shrink-0 rounded-lg border disabled:opacity-40"
                      style={{ borderColor: "var(--vg-rule)" }}
                    >
                      ›
                    </button>
                  </div>
                </div>
              )}

              <fieldset>
                <legend className="t-13" style={{ color: "var(--vg-muted)" }}>
                  Refund customers if &ldquo;{contract?.label}&rdquo; settles
                </legend>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(["yes", "no"] as const).map((s) => (
                    <label
                      key={s}
                      className="t-15 flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2"
                      style={side === s ? { borderColor: "var(--vg-accent)", boxShadow: "0 0 0 1px var(--vg-accent)" } : { borderColor: "var(--vg-rule)" }}
                    >
                      <input type="radio" name="side" className="sr-only" checked={side === s} onChange={() => setSide(s)} />
                      {s === "yes" ? "Yes" : "No"}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- terms */}
        <section className="grid gap-4 sm:grid-cols-3">
          <label className="block sm:col-span-3">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              Your business name, as customers will see it
            </span>
            <input
              className="t-15 mt-1 w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}
              value={merchantName}
              maxLength={60}
              onChange={(e) => setMerchantName(e.target.value)}
              placeholder="e.g. Mesa Trail Tours"
            />
          </label>
          <label className="block">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              Refund per customer (USDC)
            </span>
            <input
              className="mono t-15 mt-1 w-full rounded-lg border px-3 py-2.5 text-right"
              style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}
              inputMode="decimal"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              Customers (max 50)
            </span>
            <input
              className="mono t-15 mt-1 w-full rounded-lg border px-3 py-2.5 text-right"
              style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}
              type="number"
              min={1}
              max={50}
              value={seats}
              onChange={(e) => setSeats(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
          </label>
        </section>
      </div>

      {/* ---------------------------------------------------------------- pricing panel */}
      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section className="vg-ticket px-5 py-4" aria-live="polite">
          <h2 className="t-17 font-medium">Pricing</h2>
          <p className="t-13" style={{ color: "var(--vg-muted)" }}>
            Live from Gemini{data ? `, updated ${formatClock(new Date(data.fetchedAt).getTime())}` : ""}. Estimates, not quotes.
          </p>
          <dl className="mt-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="t-15">Chance of refunds</dt>
              <dd className="mono t-21">{pct(chance)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="t-15">Expected cost</dt>
              <dd className="mono t-21">{expected === null ? "—" : usd(expected)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="t-15">Worst case, locked now</dt>
              <dd className="mono t-21">{usd(worstCase)}</dd>
            </div>
          </dl>
          <p className="t-13 mt-3" style={{ color: "var(--vg-muted)" }}>
            Expected cost = chance × {seats} refunds of {usd(refundNum)} USDC. The worst case is what you lock on Arc; unused places come back to
            you.
          </p>
        </section>

        <section className="vg-ticket px-5 py-4">
          <h2 className="t-15 font-medium">Hedge, for information</h2>
          <p className="t-13 mt-1" style={{ color: "var(--vg-muted)" }}>
            To offset the refunds you could buy {Math.ceil(worstCase)} &ldquo;{side === "yes" ? "Yes" : "No"}&rdquo; contracts on Gemini (each pays $1)
            {hedgePrice === null ? ", no live price right now." : ` at about $${hedgePrice.toFixed(2)}, roughly $${usd(Math.ceil(worstCase) * hedgePrice)} in total.`}{" "}
            HonorCat never places orders.
          </p>
        </section>

        <Fund
          template={template}
          market={market}
          contract={contract}
          side={side}
          merchantName={merchantName}
          refund={refund}
          seats={seats}
        />
      </aside>
    </div>
  );
}

type Prepared = {
  terms: Record<string, unknown> & { promise: string; lockTime: number };
  seal: string;
  amount: string;
  salt: Hex;
  validAfter: string;
  validBefore: string;
  typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, string> };
};

function Fund(p: { template: Template; market: Market | null; contract: Contract | null; side: "yes" | "no"; merchantName: string; refund: string; seats: number }) {
  const { connect, adapter } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; promise: string } | null>(null);
  const ready = p.market && p.contract && p.merchantName.trim() && Number(p.refund) >= 0.1;

  async function fund() {
    if (!p.market || !p.contract) return;
    setErr(null);
    try {
      setBusy("Connect your wallet…");
      const merchant = await connect();
      if (!merchant) throw new Error("Wallet not connected");
      setBusy("Preparing terms…");
      const prep = await getJson<Prepared>("/api/guarantees/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          template: p.template,
          eventTicker: p.market.ticker,
          contractTicker: p.contract.ticker,
          side: p.side,
          merchantName: p.merchantName.trim(),
          merchant,
          refund: Number(p.refund).toFixed(2),
          maxCustomers: p.seats,
        }),
      });
      setBusy("Confirm once in your wallet. No fees.");
      const m = prep.typedData.message;
      const signature = await adapter.signTypedData({
        domain: { ...prep.typedData.domain, chainId: Number(prep.typedData.domain.chainId) },
        types: prep.typedData.types,
        primaryType: prep.typedData.primaryType,
        message: { ...m, value: BigInt(m.value!), validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) },
      } as unknown as TypedDataDefinition);
      setBusy("Setting the refunds aside…");
      const created = await getJson<{ id: string }>("/api/guarantees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terms: prep.terms,
          seal: prep.seal,
          authorization: { from: merchant, validAfter: prep.validAfter, validBefore: prep.validBefore, salt: prep.salt, signature },
        }),
      });
      setDone({ id: created.id, promise: prep.terms.promise });
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (done) return <Share id={done.id} promise={done.promise} />;
  return (
    <section className="vg-ticket px-5 py-4">
      <button
        type="button"
        onClick={fund}
        disabled={!ready || busy !== null}
        className="t-15 w-full rounded-xl px-4 py-3 font-medium disabled:opacity-50"
        style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}
      >
        Lock {(Number(p.refund) * p.seats || 0).toFixed(2)} USDC and publish
      </button>
      <p className="t-13 mt-2" style={{ color: "var(--vg-muted)" }}>
        {busy ?? (ready ? "You confirm once in your wallet. No approval step and no network fees." : "Choose a market and enter your business name and refund (at least 0.10 USDC).")}
      </p>
      {err && (
        <p className="t-13 mt-2" style={{ color: "var(--negative)" }}>
          {err}
        </p>
      )}
    </section>
  );
}

function Share({ id, promise }: { id: string; promise: string }) {
  const url = useMemo(() => (typeof window === "undefined" ? `/g/${id}` : `${window.location.origin}/g/${id}`), [id]);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 1, width: 180 }).then(setQr).catch(() => setQr(null));
  }, [url]);
  // The badge links to the public proof page, so a shopper can check the locked money.
  const badge = `<a href="${url}/proof"><img src="${url.replace(`/g/${id}`, `/api/guarantees/${id}/badge`)}" alt="Guaranteed by HonorCat" height="28"></a>`;
  return (
    <section className="vg-ticket space-y-4 px-5 py-4">
      <div>
        <h2 className="t-17 font-medium">Your guarantee is live</h2>
        <p className="t-13 mt-1" style={{ color: "var(--vg-muted)" }}>
          {promise}
        </p>
      </div>
      <label className="block">
        <span className="t-13" style={{ color: "var(--vg-muted)" }}>
          Share link
        </span>
        <input readOnly value={url} onFocus={(e) => e.target.select()} className="mono t-13 mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-page)" }} />
      </label>
      {qr && <div className="w-[180px] rounded-lg bg-white p-1" aria-label="QR code for the share link" dangerouslySetInnerHTML={{ __html: qr }} />}
      <label className="block">
        <span className="t-13" style={{ color: "var(--vg-muted)" }}>
          Badge for your checkout page
        </span>
        <textarea readOnly rows={3} value={badge} onFocus={(e) => e.target.select()} className="mono mt-1 w-full rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-page)" }} />
      </label>
      <a href={`/g/${id}`} className="t-15 block underline underline-offset-4">
        Open the customer page
      </a>
    </section>
  );
}
