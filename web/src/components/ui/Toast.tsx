"use client";

import { useEffect, useSyncExternalStore } from "react";

/** A short message after an action ("Joined. The rope starts in about 30 seconds."). One at a time. */
let current: { text: string; key: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string) {
  current = { text, key: Date.now() };
  emit();
}

export function Toaster() {
  const t = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => {
      if (current?.key === t.key) {
        current = null;
        emit();
      }
    }, 5000);
    return () => clearTimeout(h);
  }, [t]);
  if (!t) return null;
  return (
    <div key={t.key} className="hc-toast" role="status" aria-live="polite">
      {t.text}
    </div>
  );
}
