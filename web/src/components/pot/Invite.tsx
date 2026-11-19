"use client";

import { useEffect, useState } from "react";
import { InviteQR } from "@/components/pot/InviteQR";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { plainError } from "@/lib/messages";
import { notifyMe, pushSupported } from "@/lib/push";
import { SITE_URL } from "@/lib/site";

const saved = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

/**
 * "Notify me" for a pot: asks for notifications once; remembers on this device that it is on, so a
 * reload does not offer it again. Errors show beside the button, not in its label.
 */
export function NotifyButton({ potId, account, when = "join" }: { potId: string; account: string | null; when?: "join" | "change" }) {
  const key = `hc.notify.${potId}`;
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => {
      setSupported(pushSupported());
      setOn(saved(key));
    });
  }, [key]);
  if (!supported) return null;
  return (
    <>
      <Button
        variant="quiet"
        busy={busy}
        disabled={on}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await notifyMe(potId, account);
            setOn(true);
            try {
              localStorage.setItem(key, "1");
            } catch {}
            toast(when === "join" ? "We will tell you when someone joins." : "We will tell you when this pot changes.");
          } catch (e) {
            setErr(plainError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {on ? "Notifications on" : when === "join" ? "Notify me when someone joins" : "Notify me when it changes"}
      </Button>
      {err && (
        <span role="alert" style={{ flexBasis: "100%", fontSize: 15, color: "var(--hc-accent)" }}>
          {err}
        </span>
      )}
    </>
  );
}

/**
 * Inviting the other player to an open pot or perp: share (the phone's share sheet where there is
 * one), copy the link, get notified, and a QR code to scan.
 */
export function Invite({ path, text, potId, account, extra }: { path: string; text: string; potId?: string; account?: string | null; extra?: React.ReactNode }) {
  const url = () => `${SITE_URL}${path}`;
  // Clipboard can be missing or refused (some browsers, embedded views): say so and show the link.
  const copy = async (ok: string) => {
    const done = navigator.clipboard ? await navigator.clipboard.writeText(url()).then(() => true, () => false) : false;
    toast(done ? ok : `Copying did not work here. The link: ${url()}`);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Button
          onClick={async () => {
            if (navigator.share) await navigator.share({ title: "HonorCat", text, url: url() }).catch(() => {});
            else await copy("Link copied. Send it to the other player.");
          }}
        >
          Share the invite
        </Button>
        <Button
          variant="quiet"
          onClick={() => copy("Link copied.")}
        >
          Copy the link
        </Button>
        {potId && <NotifyButton potId={potId} account={account ?? null} />}
        {extra}
      </div>
      <InviteQR url={`${SITE_URL}${path}`} label="Or let them scan this" />
    </div>
  );
}
