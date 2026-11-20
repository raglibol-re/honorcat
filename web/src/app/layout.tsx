import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet/context";

import { TechModeProvider } from "@/components/TechMode";
import { RefCapture } from "@/components/RefCapture";
import { Toaster } from "@/components/ui/Toast";
import { HonorBell } from "@/components/honor/HonorBell";
import { AppShell } from "@/components/app/AppShell";
import "./globals.css";

const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
// HonorCat design reference (docs/design): Barlow 400/500/600, Barlow Condensed 500/600/700, IBM Plex Mono 400/500.
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-condensed" });

export const metadata: Metadata = {
  title: { default: "HonorCat · Money in the air", template: "%s · HonorCat" },
  description: "Two people, one pot, one question on Gemini. Each side's share follows the price and either can step off at that share. Test version on Arc testnet.",
  applicationName: "HonorCat",
  // Added to the home screen on iPhone and iPad: full screen, its own name, the paper-coloured status bar.
  appleWebApp: { capable: true, title: "HonorCat", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Older iPhones (before iOS 16.4) read only this tag to open the home-screen app full screen.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#ECEAE4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexMono.variable} ${barlow.variable} ${barlowCondensed.variable} hc-root h-full antialiased`}>
      <head>
        {/* Keeps the browser's install offer if it arrives before the app has started (lib/installApp.ts). */}
        <script
          dangerouslySetInnerHTML={{
            __html: "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__hcInstall=e;});",
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <TechModeProvider>
          <WalletProvider>
            <RefCapture />
            {children}
            <Toaster />
            <HonorBell />
            <AppShell />
          </WalletProvider>
        </TechModeProvider>
      </body>
    </html>
  );
}
