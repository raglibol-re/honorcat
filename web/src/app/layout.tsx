import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { WalletProvider } from "@/lib/wallet/context";
import { LiveLine } from "@/components/LiveLine";
import { HonorCatLogo } from "@/components/brand/HonorCatMark";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: { default: "HonorCat · Promises that always land", template: "%s · HonorCat" },
  description: "Refund promises backed by USDC locked on Arc and settled from live Gemini markets. HonorCat, settled by Verdict. Testnet demo.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1110" },
  ],
};

const nav = [
  { href: "/guarantees", label: "Guarantees" },
  { href: "/guarantees/new", label: "New guarantee" },
  { href: "/account", label: "Your account" },
  { href: "/ledger", label: "Ledger" },
  { href: "/live", label: "Live" },
  { href: "/developers", label: "Developers" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} vg h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <WalletProvider>
          <p className="t-13 px-4 py-2 text-center" style={{ background: "var(--vg-warn-bg)", color: "var(--vg-warn-ink)" }}>
            Arc testnet with test USDC. A demo of conditional refunds, not insurance. No real hedge is placed.
          </p>
          <header className="border-b" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}>
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/" aria-label="HonorCat home" style={{ color: "var(--vg-ink)" }}>
                <HonorCatLogo size={20} />
              </Link>
              <nav className="t-15 flex flex-wrap gap-x-5 gap-y-1" style={{ color: "var(--vg-muted)" }}>
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="hover:underline hover:underline-offset-4">
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>
          <footer className="border-t" style={{ borderColor: "var(--vg-rule)" }}>
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4">
              <LiveLine />
              <span className="t-13" style={{ color: "var(--vg-muted)" }}>
                HonorCat, settled by Verdict on Arc testnet. Market data from Gemini.
              </span>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
