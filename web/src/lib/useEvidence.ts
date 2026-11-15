"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { getJson } from "./api";
import { evidenceMessage } from "./evidence";
import { joinChallenge, savedPasskey, signChallenge } from "./passkey";
import { useWallet, type WalletKind } from "./wallet/context";

export type RawSignature = { signer: string; kind: string; outcome: boolean; evidenceHash: string | null; record: Record<string, unknown> | null };
type Evidence = { viewer: Address; signatures: RawSignature[] };

const KEY = (id: string) => `honorcat.evidence.${id}`;
const post = <T,>(path: string, body: unknown) => getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * Raw evidence for a payout's funder and recipients: one signature (passkey, EVM wallet or a
 * Solana wallet's Arc account) gets a one-hour token, kept in this tab.
 */
export function useEvidence(id: string) {
  const wallet = useWallet();
  const [data, setData] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (token: string) => {
      const r = await getJson<Evidence>(`/api/early/${id}/evidence`, { headers: { authorization: `Bearer ${token}` } });
      setData(r);
    },
    [id],
  );

  useEffect(() => {
    let token: string | null = null;
    try {
      token = window.sessionStorage.getItem(KEY(id));
    } catch {
      token = null;
    }
    if (token) {
      const t = token;
      void Promise.resolve()
        .then(() => load(t))
        .catch(() => window.sessionStorage.removeItem(KEY(id)));
    }
  }, [id, load]);

  async function finish(body: Record<string, unknown>) {
    const s = await post<{ token: string }>(`/api/early/${id}/evidence/session`, body);
    try {
      window.sessionStorage.setItem(KEY(id), s.token);
    } catch {
      /* the token lives for this page only */
    }
    await load(s.token);
  }

  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    } finally {
      setBusy(false);
    }
  }

  const passkey = typeof window === "undefined" ? null : savedPasskey();

  const withPasskey = () =>
    run(async () => {
      const session = savedPasskey();
      if (!session) throw new Error("No passkey on this device. Use the wallet you joined or funded with.");
      const issuedAt = new Date().toISOString();
      const assertion = await signChallenge(session, await joinChallenge(evidenceMessage(id, session.account, issuedAt)));
      await finish({ account: session.account, issuedAt, passkey: assertion });
    });

  const withWallet = (kind: WalletKind) =>
    run(async () => {
      const ad = kind === "solana" ? wallet.solana : wallet.evm;
      wallet.setKind(kind);
      const account = await ad.connect();
      if (!ad.signMessage) throw new Error("This wallet cannot sign messages.");
      const issuedAt = new Date().toISOString();
      const signature = await ad.signMessage(evidenceMessage(id, account, issuedAt));
      await finish({ account, issuedAt, signature });
    });

  return { data, busy, error, hasPasskey: !!passkey, withPasskey, withWallet };
}
