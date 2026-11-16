"use client";

import { getJson } from "./api";

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Asks for permission and subscribes this browser to one pot's notifications. */
export async function notifyMe(potId: string, account: string | null) {
  if (!pushSupported()) throw new Error("This browser cannot show notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this site.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { publicKey } = await getJson<{ publicKey: string }>("/api/hc/push");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  await getJson("/api/hc/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ potId, account, subscription: sub.toJSON() }) });
}
