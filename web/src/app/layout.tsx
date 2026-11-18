import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet/context";

import { TechModeProvider } from "@/components/TechMode";
import { RefCapture } from "@/components/RefCapture";
import { Toaster } from "@/components/ui/Toast";
import "./globals.css";

const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
// HonorCat design reference (docs/design): Barlow 400/500/600, Barlow Condensed 500/600/700, IBM Plex Mono 400/500.
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-condensed" });

export const metadata: Metadata = {
  title: { default: "HonorCat · Money in the air", template: "%s · HonorCat" },
  description: "Two people, one pot, one question on Gemini. Each side's share follows the price and either can step off at that share. Test version on Arc testnet.",
};

export const viewport: Viewport = {
  themeColor: "#ECEAE4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexMono.variable} ${barlow.variable} ${barlowCondensed.variable} hc-root h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TechModeProvider>
          <WalletProvider>
            <RefCapture />
            {children}
            <Toaster />
          </WalletProvider>
        </TechModeProvider>
      </body>
    </html>
  );
}
