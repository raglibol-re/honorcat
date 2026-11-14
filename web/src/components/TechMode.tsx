"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/**
 * "Show technical details": off by default so HonorCat reads like any consumer app; on, it adds
 * transaction hashes, block numbers, the live chain line and the technical pages back. Stored per
 * browser; nothing technical is ever removed, only revealed on demand.
 */
const KEY = "honorcat.tech-details";
const listeners = new Set<() => void>();
const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};

const Ctx = createContext<{ tech: boolean; setTech: (v: boolean) => void }>({ tech: false, setTech: () => {} });

export function TechModeProvider({ children }: { children: React.ReactNode }) {
  const tech = useSyncExternalStore(subscribe, read, () => false);
  const setTech = useCallback((v: boolean) => {
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  }, []);
  return <Ctx.Provider value={{ tech, setTech }}>{children}</Ctx.Provider>;
}

export const useTechMode = () => useContext(Ctx);

export function TechToggle() {
  const { tech, setTech } = useTechMode();
  return (
    <label className="t-13 inline-flex cursor-pointer items-center gap-2" style={{ color: "var(--vg-muted)" }}>
      <span
        role="switch"
        aria-checked={tech}
        tabIndex={0}
        onClick={() => setTech(!tech)}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), setTech(!tech))}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{ background: tech ? "var(--vg-accent)" : "var(--vg-rule)" }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full transition-transform"
          style={{ background: "var(--vg-card)", transform: tech ? "translateX(18px)" : "translateX(2px)" }}
        />
      </span>
      Show technical details
    </label>
  );
}

/** Renders children only in technical mode. */
export function TechOnly({ children }: { children: React.ReactNode }) {
  const { tech } = useTechMode();
  return tech ? <>{children}</> : null;
}
