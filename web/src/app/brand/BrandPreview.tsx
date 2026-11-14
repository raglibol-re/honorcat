"use client";

import { useEffect, useState } from "react";
import { HonorCatLogo, HonorCatMark } from "@/components/brand/HonorCatMark";
import { GuaranteeCard } from "@/components/guarantee/GuaranteeCard";
import { getJson } from "@/lib/api";
import { toCard, type GuaranteeDetail } from "@/lib/guarantees";

// Two existing guarantees on real Gemini markets (unlisted test runs): one refunded, one open.
const REFUNDED = "13vlrHgSSa";
const OPEN = "1tDGd9vAy_";

function Badge() {
  return (
    <a
      href={`/g/${REFUNDED}/proof`}
      className="t-13 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-medium"
      style={{ borderColor: "var(--vg-accent)", color: "var(--vg-accent)", background: "var(--vg-accent-soft)" }}
    >
      <HonorCatMark size={14} />
      Guaranteed by HonorCat
    </a>
  );
}

export function BrandPreview() {
  const [cards, setCards] = useState<{ open: GuaranteeDetail; refunded: GuaranteeDetail } | null>(null);
  useEffect(() => {
    Promise.all([getJson<GuaranteeDetail>(`/api/guarantees/${OPEN}`), getJson<GuaranteeDetail>(`/api/guarantees/${REFUNDED}`)])
      .then(([open, refunded]) => setCards({ open, refunded }))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="t-27 font-semibold">HonorCat: mark and card for approval</h1>
        <p className="t-15 mt-1" style={{ color: "var(--vg-muted)" }}>
          Temporary page, not linked anywhere. Nothing else is renamed until approved.
        </p>
      </div>

      {(["light", "dark"] as const).map((theme) => (
        <section key={theme} className={`vg vg-${theme} space-y-8 rounded-2xl px-5 py-8 sm:px-8`}>
          <h2 className="t-15" style={{ color: "var(--vg-muted)" }}>
            {theme === "light" ? "Light" : "Dark"}
          </h2>
          <div className="flex flex-wrap items-end gap-8">
            {[16, 24, 48, 96].map((s) => (
              <div key={s} className="flex flex-col items-center gap-2" style={{ color: "var(--vg-accent)" }}>
                <HonorCatMark size={s} />
                <span className="mono t-13" style={{ color: "var(--vg-muted)" }}>
                  {s}px
                </span>
              </div>
            ))}
            <div className="flex flex-col items-center gap-2" style={{ color: "var(--vg-ink)" }}>
              <HonorCatMark size={48} />
              <span className="mono t-13" style={{ color: "var(--vg-muted)" }}>
                ink
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <HonorCatLogo size={28} />
            <p className="t-17" style={{ color: "var(--vg-muted)" }}>
              Promises that always land.
            </p>
          </div>
          <div className="space-y-2">
            <p className="t-13" style={{ color: "var(--vg-muted)" }}>
              Checkout badge (links to the public proof page)
            </p>
            <Badge />
          </div>
          <div className="grid justify-items-center gap-8 lg:grid-cols-2 lg:items-start">
            {cards ? (
              <>
                <GuaranteeCard g={toCard(cards.open, cards.open.customers[0]?.account ?? null)} brand />
                <GuaranteeCard g={toCard(cards.refunded, cards.refunded.customers[0]?.account ?? null)} brand />
              </>
            ) : (
              <p className="t-15">Loading the two guarantees…</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
