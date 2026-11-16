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
    <label className="inline-flex cursor-pointer items-center gap-2" style={{ fontSize: 15, color: "inherit", padding: "12px 0" }}>
      <span
        role="switch"
        aria-checked={tech}
        aria-label="Show technical details"
        tabIndex={0}
        onClick={() => setTech(!tech)}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), setTech(!tech))}
        className="relative inline-flex h-5 w-9 shrink-0 items-center"
        style={{ border: "1.5px solid currentColor", background: tech ? "#E8421A" : "transparent" }}
      >
        <span className="inline-block h-3 w-3" style={{ background: "currentColor", transform: tech ? "translateX(19px)" : "translateX(2px)" }} />
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
