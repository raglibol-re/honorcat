"use client";

import { useState } from "react";
import { C, F } from "@/components/cat/tokens";
import { HelperBubble } from "@/components/helper/Helper";
import { SignIn, useActor } from "@/components/pot/Who";
import { createSeat } from "@/lib/agent";
import { connectMessage, connectorLink } from "@/lib/grokBot";
import { plainError } from "@/lib/messages";

import { Button } from "@/components/ui/Button";
const mono: React.CSSProperties = { fontFamily: F.mono, fontSize: 13, overflowWrap: "anywhere", background: C.panel, border: `1px solid ${C.faint}`, padding: "6px 8px" };

/** Copies `value`; the button says so for a moment. */
function CopyButton({ value, label, primary = false }: { value: string; label: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={primary ? "primary" : "quiet"}
      size={primary ? "md" : "sm"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 3000);
        } catch {
          /* the value is shown to copy by hand */
        }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

/**
 * The whole Grok Bot connection in one place: sign in, one click for a seat, one copy for the
 * message to paste into Grok Bot (the connector link and the job description together). Plan B if
 * the Bot cannot add connectors itself: the single link for "Add a custom connector".
 */
export function ConnectGrokBot() {
  const who = useActor();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!who.actor) return <SignIn who={who} purpose="Sign in to connect your Grok Bot. A passkey on this device is enough." />;
  if (!token)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              setToken((await createSeat(who.actor!, "My Grok Bot")).token);
            } catch (e) {
              setErr(plainError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Confirm with your passkey or wallet…" : "Connect my Grok Bot"}
        </Button>
        <span style={{ fontSize: 14, color: C.muted }}>One confirmation. The seat lasts 24 hours and plays test pots up to $2; you can revoke it on your account page at any time.</span>
        {err && (
          <p role="alert" style={{ margin: 0, color: C.signalInk }}>
            {err}
          </p>
        )}
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, border: `2px solid ${C.ink}`, padding: "14px 16px" }}>
      <strong style={{ fontFamily: F.cond, fontSize: 28, fontWeight: 600 }}>Your Grok Bot&apos;s seat is ready</strong>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 17 }}>
          <strong>Copy this message and paste it into your Grok Bot.</strong> It asks the Bot to add HonorCat and gives it its job.
        </span>
        <CopyButton value={connectMessage(token)} label="Copy the message for Grok Bot" primary />
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 15, minHeight: 32 }}>If your Bot cannot add it by itself</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
          <span style={{ fontSize: 15, lineHeight: 1.5 }}>
            In Grok Bot open Connect apps → Add a custom connector, name it <strong>honorcat</strong>, choose <strong>Remote HTTPS</strong>, and paste this link as the Server URL (nothing else):
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={mono}>{connectorLink(token)}</code>
            <CopyButton value={connectorLink(token)} label="Copy the link" />
          </div>
        </div>
      </details>
      <HelperBubble
        pose="talk"
        lines={[
          "The link is your seat's key: keep it to yourself. It stops working after 24 hours, or the moment you revoke it on your account page.",
          "Then tell your Bot “take my HonorCat invite” after starting a practice pot against it, or “mind my HonorCat pot” after letting it mind one.",
        ]}
      />
    </div>
  );
}
