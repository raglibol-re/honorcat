"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Cat } from "@/components/cat/Cat";
import { C, F } from "@/components/cat/tokens";
import { AccountLine, btn, SignIn, useActor } from "@/components/pot/Who";
import { getJson } from "@/lib/api";
import { saveSeat } from "./[id]/Together";

/** Starts a shared draft and takes the host's seat. */
export function StartTogether() {
  const router = useRouter();
  const who = useActor();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 720 }}>
      <Cat pose="second" size={240} />
      <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Start a pot with a friend</h1>
      <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body }}>
        You get a link for your friend. You both see the same draft and pick the question, the sides and the size together. Then each of you puts in your side with one
        confirmation, and the pot starts at the market&apos;s price at that moment. The pot is only for the two of you; it is never offered to anyone else.
      </p>
      {!who.actor ? (
        <SignIn who={who} purpose="Your account holds your side of the pot. A passkey on this device is enough; HonorCat pays the network fees." />
      ) : (
        <>
          <AccountLine who={who} />
          <button
            type="button"
            style={{ ...btn, alignSelf: "flex-start" }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await getJson<{ id: string; token: string }>("/api/hc/drafts", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ account: who.actor!.account, kind: who.actor!.kind }),
                });
                saveSeat(r.id, r.token);
                router.push(`/pots/together/${r.id}`);
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Get the link for my friend
          </button>
        </>
      )}
      {err && <p role="alert" style={{ margin: 0, color: C.signalInk }}>{err}</p>}
    </div>
  );
}
