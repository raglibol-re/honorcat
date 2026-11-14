import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet/context";
import { WalletButton } from "@/components/WalletButton";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Verdict",
  description: "Conditional USDC payouts on Arc testnet",
};

const nav = [
  { href: "/create", label: "Create pot" },
  { href: "/pots", label: "Pots" },
  { href: "/ledger", label: "Ledger" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <WalletProvider>
          <header className="border-b border-border bg-surface">
            <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
              <Link href="/" className="text-sm font-semibold tracking-tight">
                Verdict
              </Link>
              <div className="flex items-center gap-6">
                <nav className="flex gap-5 text-sm text-muted">
                  {nav.map((n) => (
                    <Link key={n.href} href={n.href} className="hover:text-foreground">
                      {n.label}
                    </Link>
                  ))}
                </nav>
                <WalletButton />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
          <footer className="border-t border-border py-4 text-center text-xs text-muted">
            Arc testnet · test funds only
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
