"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { C } from "@/components/cat/tokens";
import { InviteQR } from "@/components/pot/InviteQR";
import { INSTALL_ON, promptInstall, useInstall, type InstallState } from "@/lib/installApp";

/**
 * "Get the app" in the header (phones): one tap installs where the browser allows it, otherwise it
 * opens /app with the steps for this phone. Hidden inside the installed app.
 */
export function InstallHeaderButton() {
  const s = useInstall();
  if (!INSTALL_ON || !s.ready || s.standalone || s.installed) return null;
  if (s.canPrompt)
    return (
      <button type="button" className="hc-btn hc-btn--sm hc-install-head" onClick={() => void promptInstall()}>
        <Label />
      </button>
    );
  return (
    <Link href="/app" className="hc-btn hc-btn--sm hc-install-head" style={{ textDecoration: "none" }}>
      <Label />
    </Link>
  );
}

/** "Get the app", shortened to "App" on the narrowest phones so the header stays on one line. */
function Label() {
  return (
    <>
      <span className="hc-install-long">Get the app</span>
      <span className="hc-install-short" aria-hidden="true">App</span>
    </>
  );
}

/** Inside the installed app there is no browser back button: a Back button in the header instead. */
export function AppBackButton() {
  const s = useInstall();
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    const check = () => setCanGoBack(window.history.length > 1 && window.location.pathname !== "/");
    check();
    window.addEventListener("popstate", check);
    const t = window.setInterval(check, 800);
    return () => {
      window.removeEventListener("popstate", check);
      window.clearInterval(t);
    };
  }, []);
  if (!s.standalone || !canGoBack) return null;
  return (
    <button type="button" className="hc-btn hc-btn--quiet hc-btn--sm" aria-label="Back" onClick={() => window.history.back()} style={{ marginRight: 4 }}>
      ‹ Back
    </button>
  );
}

const step = { margin: 0, fontSize: 17, lineHeight: 1.5 } as const;

function Steps({ s }: { s: InstallState }) {
  if (s.inAppBrowser)
    return (
      <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        <li style={step}>This page is open inside another app, which cannot install apps.</li>
        <li style={step}>Tap the menu (••• or ⋮) and choose <strong>Open in browser</strong> (Safari on iPhone, Chrome on Android).</li>
        <li style={step}>Come back to this page there and tap <strong>Get the app</strong>.</li>
      </ol>
    );
  if (s.platform === "ios")
    return (
      <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        <li style={step}>
          Tap <strong>Share</strong> <ShareIcon /> in Safari&apos;s toolbar (at the bottom on iPhone, at the top on iPad). In Chrome on iPhone it is at the top right.
        </li>
        <li style={step}>
          Scroll down and tap <strong>Add to Home Screen</strong>.
        </li>
        <li style={step}>
          Tap <strong>Add</strong>. HonorCat is now on your home screen and opens full screen.
        </li>
      </ol>
    );
  if (s.platform === "android")
    return (
      <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        <li style={step}>
          Open the browser menu <strong>⋮</strong> (top right in Chrome, bottom in Samsung Internet).
        </li>
        <li style={step}>
          Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
        </li>
        <li style={step}>Confirm. HonorCat is now with your other apps and opens full screen.</li>
      </ol>
    );
  return (
    <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
      <li style={step}>
        <strong>Chrome or Edge:</strong> click the install icon at the right end of the address bar, or open the menu and choose <strong>Install HonorCat</strong>.
      </li>
      <li style={step}>
        <strong>Safari on a Mac:</strong> File, then <strong>Add to Dock</strong>.
      </li>
      <li style={step}>
        <strong>On your phone:</strong> scan the code and follow the steps there.
      </li>
    </ol>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true" style={{ verticalAlign: "-3px", margin: "0 2px" }}>
      <path d="M8 1v12M4 5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 8H2v11h12V8h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** The /app page body: install in one tap where possible, the steps for this device otherwise. */
export function InstallPanel() {
  const s = useInstall();
  if (!s.ready) return <p style={{ ...step, color: C.muted }}>Checking your device…</p>;
  if (!INSTALL_ON) return <p style={step}>The app is not available right now. HonorCat works in any browser.</p>;
  if (s.standalone)
    return (
      <p style={step}>
        You are in the HonorCat app. <Link href="/">Go to the start page</Link>.
      </p>
    );
  if (s.installed)
    return (
      <p style={step}>
        Installed. Open HonorCat from your home screen or app list.
      </p>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {s.canPrompt && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <button type="button" className="hc-btn" onClick={() => void promptInstall()}>
            Install HonorCat
          </button>
          <p style={{ margin: 0, fontSize: 15, color: C.muted }}>Free, no app store. Opens full screen, like any other app.</p>
        </div>
      )}
      {!s.canPrompt && <Steps s={s} />}
      {s.platform === "desktop" && <InviteQR url={`${window.location.origin}/app`} size={170} label="Scan with your phone's camera" />}
    </div>
  );
}
