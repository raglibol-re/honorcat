"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cat, type Cosmetic } from "@/components/cat/Cat";
import { C, F } from "@/components/cat/tokens";

import { getJson } from "@/lib/api";
import { txUrl } from "@/lib/chain";
import { formatDate } from "@/lib/format";
import { FURS, furOf } from "@/lib/names";

import { Button } from "@/components/ui/Button";
import { money } from "@/lib/currency";
type TreatItem = { kind: "MakerTreat" | "ExitFee" | "ReferralTreat" | "CopycatTreat"; potId: string | null; amount: string; from: string; tx: string; at: number | null; profit: string | null };
type Treats = { total: string; totals: Record<TreatItem["kind"], string>; copycats: number; referred: number; items: TreatItem[] };
type Cosmetics = { wear: Cosmetic | null; unlocked: { wear: Cosmetic; label: string }[]; next: { wear: Cosmetic; label: string; need: string; left: string } | null };

const $ = (base: bigint | number | string) => money(base);
const KIND: Record<TreatItem["kind"], { title: string; what: string }> = {
  MakerTreat: { title: "Making", what: "maker treat: someone joined a pot you opened (0.25% of their deposit)" },
  ExitFee: { title: "Staying", what: "exit fee: the other side left early (1% of the pot value they took out)" },
  ReferralTreat: { title: "Referrals", what: "referral: a player you invited paid a fee (20% of it, for their first 20 pots)" },
  CopycatTreat: { title: "Copycats", what: "copycat treat: a player who copied you made a profit (5% of it)" },
};

/**
 * Treats an account earned (each a share of a fee another player paid, never minted), the cat's
 * cosmetics with the next unlock, and, on the player's own page, their referral link.
 */
export function TreatsPanel({ account, mine }: { account: string; mine: boolean }) {
  const [t, setT] = useState<Treats | null>(null);
  const [c, setC] = useState<Cosmetics | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    getJson<Treats>(`/api/hc/treats?account=${account}`)
      .then((r) => alive && setT(r))
      .catch(() => {});
    getJson<Cosmetics>(`/api/hc/cosmetics?account=${account}`)
      .then((r) => alive && setC(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account]);
  // The invite link carries a short code, never the address.
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    getJson<{ code: string }>(`/api/hc/ref?account=${account}`)
      .then((r) => setCode(r.code))
      .catch(() => {});
  }, [account]);
  const link = typeof window === "undefined" || !code ? "" : `${window.location.origin}/?ref=${code}`;
  const h2 = { margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 } as const;
  const fur = FURS[furOf(account)];
  return (
    <section aria-label="Treats and cosmetics" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {c && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={h2}>Cat cosmetics</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end" }}>
            {c.unlocked.map((u) => (
              <figure key={u.wear} style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 92 }}>
                <Cat pose="face" size={64} fur={fur} wear={u.wear} label={u.label} />
                <figcaption style={{ fontSize: 13, textAlign: "center" }}>
                  {u.label}
                  {c.wear === u.wear && <span style={{ display: "block", color: C.muted }}>wearing</span>}
                </figcaption>
              </figure>
            ))}
            {c.next && (
              <figure style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 120, opacity: 0.55 }}>
                <Cat pose="face" size={64} fur={fur} wear={c.next.wear} label={`Next: ${c.next.label}`} />
                <figcaption style={{ fontSize: 13, textAlign: "center" }}>
                  Next: {c.next.label}
                  <span style={{ display: "block", color: C.body }}>{c.next.left} to go</span>
                </figcaption>
              </figure>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Unlocked by the honor record, worn on this cat everywhere. Practice pots do not count.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={h2}>Treats</h2>
        <p style={{ margin: 0, fontSize: 16, color: C.body }}>Every treat is a share of a fee another player paid. Nothing is minted and nothing goes to HonorCat.</p>
        {t && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 28px" }}>
              {(Object.keys(KIND) as TreatItem["kind"][]).map((k) => (
                <div key={k} style={{ display: "flex", flexDirection: "column", minWidth: 120, borderTop: `1.5px solid ${C.ink}`, paddingTop: 6 }}>
                  <span style={{ fontSize: 14, color: C.muted }}>{KIND[k].title}</span>
                  <span style={{ fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>{$(t.totals[k] ?? "0")}</span>
                </div>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 15, color: C.body }}>
              {t.copycats} player{t.copycats === 1 ? "" : "s"} copied this cat; {t.referred} player{t.referred === 1 ? "" : "s"} joined through its link and paid fees.
            </p>
            {t.items.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", minHeight: 32, fontSize: 16 }}>Each treat ({t.items.length})</summary>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1px solid ${C.faint}` }}>
                  {t.items.map((i) => (
                    <li key={`${i.tx}-${i.kind}-${i.amount}`} style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", padding: "8px 0", borderBottom: `1px solid ${C.faint}`, fontSize: 15 }}>
                      <span style={{ color: C.muted, minWidth: 140 }}>{i.at ? formatDate(i.at * 1000) : ""}</span>
                      <strong>{$(i.amount)}</strong>
                      <span style={{ flex: "1 1 260px" }}>{KIND[i.kind].what}</span>
                      {i.potId && <Link href={`/pots/${i.potId}`}>pot</Link>}
                      <a href={txUrl(i.tx)} target="_blank" rel="noreferrer" style={{ color: C.muted }}>
                        transaction
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      {mine && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, border: `2px solid ${C.ink}`, padding: "14px 16px", maxWidth: 680 }}>
          <strong style={{ fontFamily: F.cond, fontSize: 26, fontWeight: 600 }}>Your invite link</strong>
          <span style={{ fontSize: 15, lineHeight: 1.5 }}>
            A player who opens it before their first pot gives you 20% of the fees they pay in their first 20 pots. It comes out of the fee, not out of their pocket, and never from HonorCat.
          </span>
          <code style={{ fontFamily: "var(--font-plex-mono), monospace", fontSize: 14, overflowWrap: "anywhere", background: C.faint, padding: "6px 8px" }}>{link}</code>
          <Button variant="quiet"
            style={{ alignSelf: "flex-start" }}
            onClick={async () => {
              if (navigator.share) await navigator.share({ title: "HonorCat", text: "Play a pot with me on HonorCat", url: link }).catch(() => {});
              else await navigator.clipboard?.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? "Shared" : "Share my link"}
          </Button>
        </div>
      )}
    </section>
  );
}
