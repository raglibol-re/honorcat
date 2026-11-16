"use client";

import Link from "next/link";
import { LiveLine } from "@/components/LiveLine";
import { TechToggle, useTechMode } from "@/components/TechMode";
import { CatHead, Ears } from "./shapes";
import { C, F } from "./tokens";

const primary = [
  ["/pots/new", "Start"],
  ["/pots", "Pots"],
  ["/markets", "Markets"],
  ["/how", "How it works"],
  ["/account", "Account"],
] as const;
export const technical = [
  ["/ledger", "Ledger"],
  ["/live", "Live"],
  ["/status", "Status"],
  ["/how-it-is-built", "How it is built"],
  ["/developers", "Developers"],
] as const;
// The older refund-guarantee product stays reachable in technical mode only.
const techOnly = [["/guarantees", "Guarantees"]] as const;

/** The header from the landing reference: logo, three links, the test-money note. */
export function HcHeader() {
  const { tech } = useTechMode();
  const items = tech ? [...primary, ...technical, ...techOnly] : primary;
  return (
    <header
      className="hc-wrap"
      style={{ paddingTop: 22, paddingBottom: 22, display: "flex", flexWrap: "wrap", gap: "12px 40px", alignItems: "center", justifyContent: "space-between", width: "100%" }}
    >
      <Link href="/" aria-label="HonorCat home" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        <CatHead width={30} height={28} eyes={C.signal} />
        <span style={{ fontFamily: F.cond, fontSize: 28, fontWeight: 600, letterSpacing: "0.01em" }}>HonorCat</span>
      </Link>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: "4px 36px", fontSize: 17, fontWeight: 500 }}>
        {items.map(([href, label]) => (
          <Link key={href} href={href} style={{ textDecoration: "none", padding: "12px 0" }}>
            {label}
          </Link>
        ))}
      </nav>
      <span style={{ fontSize: 15, color: C.muted }}>Test version on Arc testnet. Test money only. Not financial advice.</span>
    </header>
  );
}

/** Footer links, the technical-details switch and the status line, on ink. */
export function HcFooterLinks() {
  const { tech } = useTechMode();
  return (
    <div
      style={{ borderTop: `1px solid ${C.muted}`, paddingTop: 20, display: "flex", flexWrap: "wrap", gap: "8px 32px", justifyContent: "space-between", alignItems: "center", fontSize: 15, color: C.faint }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span>HonorCat on Arc testnet.</span>
        {tech && <LiveLine />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 28px", alignItems: "center" }}>
        {technical.map(([href, label]) => (
          <Link key={href} href={href} style={{ color: C.page, padding: "12px 0" }}>
            {label}
          </Link>
        ))}
        <TechToggle />
      </div>
    </div>
  );
}

/** The short closing block for inner pages: ears on an ink block, the disclaimer and links. */
export function HcFooter() {
  return (
    <div style={{ marginTop: 96 }}>
      <Ears viewBox="0 0 1440 60" points={["150,61 210,3 270,61", "1170,61 1230,3 1290,61"]} />
      <footer style={{ background: C.ink, color: C.page }}>
        <div className="hc-wrap" style={{ paddingTop: 32, paddingBottom: 32, display: "flex", flexDirection: "column", gap: 24 }}>
          <p style={{ margin: 0, fontFamily: F.cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>A cat always lands on its feet.</p>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: C.faint, maxWidth: 720 }}>
            A test version on Arc testnet with test money only. Not financial advice. Prices come from Gemini markets, which can be wrong or thin.
          </p>
          <HcFooterLinks />
        </div>
      </footer>
    </div>
  );
}
