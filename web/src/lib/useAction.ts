"use client";

import { useCallback, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { pollFast } from "./api";
import { plainError } from "./messages";

/**
 * Runs one user action at a time: tracks the step it reports (for `ActionProgress`), turns errors
 * into plain words, and shows a short toast when it worked. `busy` is which action is running, so
 * only that button shows the loader.
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(name: string, f: (onStep: (s: string) => void) => Promise<T>, done?: string | ((r: T) => string | null)): Promise<T | null> => {
    setError(null);
    setBusy(name);
    setStep("Starting");
    try {
      const r = await f(setStep);
      pollFast();
      const msg = typeof done === "function" ? done(r) : done;
      if (msg) toast(msg);
      return r;
    } catch (e) {
      setError(plainError(e));
      return null;
    } finally {
      setBusy(null);
      setStep(null);
    }
  }, []);
  return { run, busy, step, error, setError, isBusy: (name: string) => busy === name, any: busy !== null };
}
