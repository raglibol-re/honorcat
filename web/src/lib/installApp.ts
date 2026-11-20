"use client";

import { useSyncExternalStore } from "react";

/**
 * Installing HonorCat as an app (a web app on the home screen). Switched on unless APP_INSTALL=off.
 * Chrome, Edge and Samsung Internet offer a one-tap install (the beforeinstallprompt event, caught
 * as early as possible by AppShell); Safari on iPhone and iPad installs through Share, then
 * "Add to Home Screen", which the instructions explain.
 */
export const INSTALL_ON = (process.env.NEXT_PUBLIC_APP_INSTALL ?? "").toLowerCase() !== "off";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type Platform = "ios" | "android" | "desktop";
export type InstallState = { ready: boolean; standalone: boolean; canPrompt: boolean; installed: boolean; platform: Platform; inAppBrowser: boolean };

let deferred: PromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = compute();
  for (const l of listeners) l();
};

function platformOf(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points tell them apart.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function compute(): InstallState {
  const ua = navigator.userAgent;
  return {
    ready: true,
    standalone: isStandalone(),
    canPrompt: deferred !== null,
    installed,
    platform: platformOf(),
    // Apps such as Instagram, Facebook or LinkedIn open links in their own browser, which cannot install.
    inAppBrowser: /FBAN|FBAV|Instagram|LinkedInApp|Line\/|Twitter|MicroMessenger|; wv\)/.test(ua),
  };
}

const SERVER: InstallState = { ready: false, standalone: false, canPrompt: false, installed: false, platform: "desktop", inAppBrowser: false };
let snapshot: InstallState = SERVER;
let started = false;

/** Called once by AppShell: catches the install offer and registers the service worker. */
export function startInstall() {
  if (started || typeof window === "undefined") return;
  started = true;
  // The offer can come before React starts; the root layout's inline script keeps it.
  const early = (window as Window & { __hcInstall?: PromptEvent }).__hcInstall;
  if (early) deferred = early;
  snapshot = compute();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", emit);
  document.documentElement.dataset.standalone = isStandalone() ? "true" : "false";
  if ("serviceWorker" in navigator) {
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }
}

/** Opens the browser's install dialog when it offers one; returns whether the player installed. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === "accepted") installed = true;
  emit();
  return outcome === "accepted";
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => SERVER,
  );
}
