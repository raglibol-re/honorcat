import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { WalletProvider } from "@/lib/wallet/context";

import { TechModeProvider } from "@/components/TechMode";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
// HonorCat design reference (docs/design): Barlow 400/500/600, Barlow Condensed 500/600/700, IBM Plex Mono 400/500.
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-condensed" });

export const metadata: Metadata = {
  title: { default: "HonorCat · Promises that always land", template: "%s · HonorCat" },
  description: "Get paid before it happens: money set aside for a group, paid out the moment a live Gemini market says the event is very likely. Testnet demo.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1110" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${barlow.variable} ${barlowCondensed.variable} vg h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TechModeProvider>
          <WalletProvider>
            {children}
          </WalletProvider>
        </TechModeProvider>
      </body>
    </html>
  );
}
