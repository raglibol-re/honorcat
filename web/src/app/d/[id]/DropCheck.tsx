"use client";

import { useEffect, useState } from "react";
import { isAddress } from "viem";
import type { DropDto } from "@verdict/relay";
import { useTechMode } from "@/components/TechMode";
import { getJson } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { formatMoney } from "@/lib/format";
import { savedPasskey } from "@/lib/passkey";

type ProofEntry = { index: number; amount: string; proof: string[]; claimedTx: string | null; deferred: boolean; claimedOnChain: boolean | null };
type ProofRes = { drop: { dropId: string | null; root: string; version: number; book: string | null }; included: boolean; total: string; entries: ProofEntry[] };

const when = (t: number) => new Date(t * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function stateLine(d: DropDto) {
  if (d.potStatus === "resolved") return d.outcome ? "It happened. Payouts are being sent." : "It did not happen. No payouts this time.";
  if (d.potStatus === "expired") return "No result arrived in time. The money went back to the sender.";
  return Date.now() / 1000 < d.lockTime ? `The list can still change until ${when(d.lockTime)}.` : "The list is final. Waiting for the result.";
}

export function DropCheck({ drop }: { drop: DropDto }) {
  const { tech } = useTechMode();
  const [account, setAccount] = useState("");
  const [res, setRes] = useState<ProofRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(a: string) {
    setErr(null);
    setRes(null);
    if (!isAddress(a)) {
      setErr("Enter an account address (0x…).");
      return;
    }
    setBusy(true);
    try {
      setRes(await getJson<ProofRes>(`/api/drops/${drop.id}/proof?account=${a}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const s = savedPasskey();
    if (!s) return;
    Promise.resolve().then(() => {
      setAccount(s.account);
      void check(s.account);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paid = res?.entries.length ? res.entries.every((e) => e.claimedTx || e.claimedOnChain) : false;

  return (
    <div className="space-y-4">
      <section className="vg-ticket space-y-2 px-5 py-4">
        <p className="t-15">{stateLine(drop)}</p>
        <p className="t-13" style={{ color: "var(--vg-muted)" }}>
          {drop.entries.toLocaleString("en-US")} people on the list, {formatMoney(drop.rootTotal)} set aside in total
          {drop.claimed > 0 ? `, ${drop.claimed.toLocaleString("en-US")} paid so far` : ""}.
        </p>
      </section>

      <form
        className="vg-ticket space-y-3 px-5 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          void check(account.trim());
        }}
      >
        <label className="t-15 block font-medium" htmlFor="acct">
          Check if you are on the list
        </label>
        <input
          id="acct"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="Your account address, 0x…"
          className="mono t-15 w-full rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={busy}
          className="t-17 w-full rounded-xl px-4 py-3 font-medium disabled:opacity-60"
          style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}
        >
          {busy ? "Checking…" : "Check"}
        </button>
        {err && (
          <p className="t-13" style={{ color: "var(--negative)" }}>
            {err}
          </p>
        )}
      </form>

      {res && (
        <section className="vg-ticket space-y-2 px-5 py-4" aria-live="polite">
          {res.included ? (
            <>
              <p className="t-17 font-medium">{paid ? `Paid: ${formatMoney(res.total)}` : `You are on the list for ${formatMoney(res.total)}`}</p>
              <p className="t-13" style={{ color: "var(--vg-muted)" }}>
                {paid
                  ? "It is in your account."
                  : drop.potStatus === "resolved" && drop.outcome
                    ? "On its way to your account."
                    : "If it happens, it is sent to your account automatically."}
              </p>
            </>
          ) : (
            <p className="t-15">This account is not on the list.</p>
          )}
          {tech && res.included && (
            <details className="t-13 pt-2" style={{ color: "var(--vg-muted)" }}>
              <summary className="cursor-pointer">Merkle proof</summary>
              <div className="mono mt-2 space-y-1 break-all">
                <p>
                  root v{res.drop.version}: {res.drop.root}
                </p>
                {res.drop.book && (
                  <p>
                    MerkleBook{" "}
                    <a className="hover:underline" href={addressUrl(res.drop.book)} target="_blank" rel="noreferrer">
                      {res.drop.book}
                    </a>
                    , drop #{res.drop.dropId}
                  </p>
                )}
                {res.entries.map((e) => (
                  <div key={e.index} className="border-t pt-1" style={{ borderColor: "var(--vg-rule)" }}>
                    <p>
                      index {e.index}, amount {e.amount}
                      {e.deferred ? " (deferred: withdraw from the book)" : ""}
                    </p>
                    <p>proof [{e.proof.join(", ")}]</p>
                    {e.claimedTx?.startsWith("0x") && (
                      <p>
                        paid in{" "}
                        <a className="hover:underline" href={txUrl(e.claimedTx)} target="_blank" rel="noreferrer">
                          {e.claimedTx.slice(0, 12)}…
                        </a>
                      </p>
                    )}
                  </div>
                ))}
                <p className="pt-1">Anyone can submit claim(dropId, index, account, amount, proof); the money always goes to the account.</p>
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
