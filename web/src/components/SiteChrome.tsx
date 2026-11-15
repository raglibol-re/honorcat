"use client";

import Link from "next/link";
import { HonorCatLogo } from "@/components/brand/HonorCatMark";
import { LiveLine } from "@/components/LiveLine";
import { TechToggle, useTechMode } from "@/components/TechMode";

const primary = [
  { href: "/early/new", label: "Pay early" },
  { href: "/guarantees", label: "Guarantees" },
  { href: "/guarantees/new", label: "Offer a guarantee" },
  { href: "/account", label: "Your account" },
];
const technical = [
  { href: "/ledger", label: "Ledger" },
  { href: "/live", label: "Live" },
  { href: "/status", label: "Status" },
  { href: "/developers", label: "Developers" },
];

export function SiteHeader() {
  const { tech } = useTechMode();
  const items = tech ? [...primary, ...technical] : primary;
  return (
    <header className="border-b" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}>
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" aria-label="HonorCat home" style={{ color: "var(--vg-ink)" }}>
          <HonorCatLogo size={20} />
        </Link>
        <nav className="t-15 flex flex-wrap gap-x-5 gap-y-1" style={{ color: "var(--vg-muted)" }}>
          {items.map((n) => (
            <Link key={n.href} href={n.href} className="hover:underline hover:underline-offset-4">
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { tech } = useTechMode();
  return (
    <footer className="border-t" style={{ borderColor: "var(--vg-rule)" }}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          {tech ? (
            <LiveLine />
          ) : (
            <p className="t-13" style={{ color: "var(--vg-muted)" }}>
              HonorCat, settled by Verdict. Test money only.
            </p>
          )}
          {!tech && (
            <nav className="t-13 flex flex-wrap gap-x-4" style={{ color: "var(--vg-muted)" }}>
              {technical.map((n) => (
                <Link key={n.href} href={n.href} className="hover:underline hover:underline-offset-4">
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <TechToggle />
      </div>
    </footer>
  );
}
