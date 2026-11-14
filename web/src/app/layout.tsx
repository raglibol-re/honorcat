import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { WalletProvider } from "@/lib/wallet/context";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { TechModeProvider } from "@/components/TechMode";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} vg h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TechModeProvider>
          <WalletProvider>
            <p className="t-13 px-4 py-2 text-center" style={{ background: "var(--vg-warn-bg)", color: "var(--vg-warn-ink)" }}>
              Test version with test money on Arc testnet. Not insurance; no real hedge is placed.
            </p>
            <SiteHeader />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>
            <SiteFooter />
          </WalletProvider>
        </TechModeProvider>
      </body>
    </html>
  );
}
