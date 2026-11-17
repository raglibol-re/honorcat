"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { AgentSeats } from "@/components/agent/AgentSeats";
import { CatName } from "@/components/cat/PlayerCat";
import { Ears, EyesSmall } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";
import { GatewayPanel } from "@/components/pot/GatewayPanel";
import { OnrampDemo } from "@/components/pot/OnrampDemo";
import { SendTo } from "@/components/pot/SendTo";
import { CatPicker, FundsHelp, SignIn, useActor, type ActorState } from "@/components/pot/Who";
import { usePolling } from "@/lib/api";
import { txUrl } from "@/lib/chain";
import { money, rateText, setHome, useHome } from "@/lib/currency";
import { plainError } from "@/lib/messages";
import { furOf, hasOwnCat, namesLoaded, nickname, useNames } from "@/lib/names";
import { sendUsdc } from "@/lib/send";

type Tab = "add" | "send" | "withdraw";
const TABS: { id: Tab; label: string }[] = [
  { id: "add", label: "Add money" },
  { id: "send", label: "Send" },
  { id: "withdraw", label: "Withdraw" },
];

const link: React.CSSProperties = { background: "none", border: 0, padding: 0, font: "inherit", fontSize: 15, color: C.muted, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" };

/**
 * "My money": the balance first, then one of three actions (add, send, withdraw) at a time, the
 * currency choice in one line, and the player's Grok Bot. One sign-in for everything on the page.
 */
export function MoneyView() {
  const who = useActor();
  useHome();
  if (!who.actor) return <SignIn who={who} purpose="Sign in to see your money. A passkey is all you need." />;
  return <Signed who={who} />;
}

function Signed({ who }: { who: ActorState }) {
  const a = who.actor!.account;
  const names = useNames([a]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [editing, setEditing] = useState(false);
  // /account#gateway (from the low-funds help) opens "Add money, from another chain".
  const [fromChain, setFromChain] = useState(false);
  useEffect(() => {
    if (window.location.hash !== "#gateway") return;
    void Promise.resolve().then(() => {
      setTab("add");
      setFromChain(true);
    });
  }, []);
  const myName = names[a.toLowerCase()] ?? nickname(a);
  const picked = hasOwnCat(a, names);
  const low = who.balance !== null && who.balance < 2_000_000n;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {((!picked && namesLoaded(a)) || editing) && (
        <CatPicker who={who} first={!picked} initialName={myName} initialFur={furOf(a)} onDone={() => setEditing(false)} onCancel={picked ? () => setEditing(false) : undefined} />
      )}

      <section aria-label="Your balance" style={{ display: "flex", flexDirection: "column" }}>
        <Ears viewBox="0 0 342 30" points={["22,31 54,2 86,31", "256,31 288,2 320,31"]} />
        <div style={{ background: C.ink, color: C.page, padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: F.cond, fontSize: 26, fontWeight: 600 }}>Your balance</span>
            <EyesSmall />
          </div>
          <span style={{ fontFamily: F.cond, fontSize: "clamp(64px, 22vw, 120px)", fontWeight: 700, lineHeight: 0.92 }}>{who.balance === null ? "…" : money(who.balance)}</span>
          <span style={{ fontSize: 15, color: C.faint }}>Test money on Arc</span>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 15, color: C.muted, display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center" }}>
          <strong style={{ color: C.ink }}>
            <CatName account={a} name={myName} />
          </strong>
          {picked && !editing && (
            <button type="button" style={link} onClick={() => setEditing(true)}>
              Change cat
            </button>
          )}
          <button type="button" style={link} onClick={() => (who.actor?.kind === "wallet" && who.wallet.kind === "circle" ? (who.wallet.circle.forget(), who.wallet.setKind("evm")) : who.signOut())}>
            Sign out
          </button>
        </p>
        {low && who.fundsNote && <FundsHelp account={a} reason={who.fundsNote} />}
      </section>

      <div role="tablist" aria-label="What to do" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={on}
              aria-controls="money-panel"
              onClick={() => setTab(on ? null : t.id)}
              style={{ minHeight: 52, padding: "0 6px", fontFamily: F.sans, fontSize: 17, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${C.ink}`, background: on ? C.ink : "transparent", color: on ? C.page : C.ink }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab && (
        <div id="money-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {tab === "add" && <AddMoney who={who} start={fromChain ? "chain" : null} />}
          {tab === "send" && <SendTo actor={who.actor!} balance={who.balance} title="" />}
          {tab === "withdraw" && <Withdraw who={who} />}
        </div>
      )}

      <Currency />
      <Guarantees account={a} />
      <AgentSeats />
    </div>
  );
}

/** Two ways in: from another chain (Circle Gateway) or by card or bank (a marked demo). */
function AddMoney({ who, start }: { who: ActorState; start: "chain" | null }) {
  const [way, setWay] = useState<"chain" | "card" | null>(start);
  const ways = [
    { id: "chain" as const, title: "From another chain", line: "USDC on Base, Ethereum, Arbitrum and more" },
    { id: "card" as const, title: "Card or bank", line: "Demo only for now", demo: true },
  ];
  return (
    <>
      <div role="radiogroup" aria-label="Add money" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
        {ways.map((w) => {
          const on = way === w.id;
          return (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setWay(w.id)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "12px 14px", textAlign: "left", font: "inherit", color: C.ink, cursor: "pointer", border: `${on ? 2.5 : 1.5}px solid ${on ? C.ink : C.faint}`, background: on ? C.panel : "transparent" }}
            >
              <strong style={{ fontSize: 18 }}>{w.title}</strong>
              <span style={{ fontSize: 14, color: w.demo ? C.signalInk : C.muted }}>{w.line}</span>
            </button>
          );
        })}
      </div>
      {way === "chain" && <GatewayPanel who={who} bare />}
      {way === "card" && <OnrampDemo bare />}
      {!way && (
        <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
          New accounts get test money automatically. More test USDC:{" "}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
            Circle faucet
          </a>
          .
        </p>
      )}
    </>
  );
}

/** Passkey accounts send everything to a wallet address; a wallet already holds its money. */
function Withdraw({ who }: { who: ActorState }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tx?: Hex; error?: boolean } | null>(null);
  if (who.actor?.kind === "wallet") return <p style={{ margin: 0, fontSize: 16, color: C.body }}>Nothing to withdraw: your money is already in your wallet.</p>;
  const bal = who.balance ?? 0n;
  const ok = isAddress(to) && bal > 0n;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || !who.actor) return;
        setBusy(true);
        setMsg(null);
        try {
          const tx = await sendUsdc(who.actor, to as Address, bal);
          setMsg({ text: `Sent ${money(bal)}.`, tx });
          await who.refresh();
        } catch (err) {
          setMsg({ text: plainError(err), error: true });
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 15, color: C.body }}>
        Your wallet address on Arc
        <input
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder="0x…"
          autoComplete="off"
          style={{ fontFamily: F.mono, fontSize: 15, minHeight: 48, padding: "0 12px", border: `1.5px solid ${C.ink}`, background: C.panel, color: C.ink, width: "100%", boxSizing: "border-box" }}
        />
      </label>
      <button type="submit" disabled={busy || !ok} style={{ minHeight: 52, background: C.ink, color: C.page, border: 0, fontFamily: F.sans, fontSize: 17, fontWeight: 600, cursor: "pointer", opacity: busy || !ok ? 0.5 : 1 }}>
        {busy ? "Sending…" : `Withdraw everything${bal > 0n ? ` (${money(bal)})` : ""}`}
      </button>
      {msg && (
        <p role={msg.error ? "alert" : "status"} style={{ margin: 0, fontSize: 15, color: msg.error ? C.signalInk : C.body }}>
          {msg.text}{" "}
          {msg.tx && (
            <a href={txUrl(msg.tx)} target="_blank" rel="noreferrer">
              See it on Arc
            </a>
          )}
        </p>
      )}
    </form>
  );
}

/** "Show amounts in $ / €" in one line; the rate only when euros are on. */
function Currency() {
  const { home, rate } = useHome();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span id="cur-label" style={{ fontSize: 15, color: C.body }}>
          Show amounts in
        </span>
        <div role="radiogroup" aria-labelledby="cur-label" style={{ display: "inline-flex", border: `1.5px solid ${C.ink}` }}>
          {(["USDC", "EURC"] as const).map((h) => {
            const on = home === h;
            return (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={h === "USDC" ? "Dollars (USDC)" : "Euros (EURC)"}
                onClick={() => setHome(h)}
                style={{ minHeight: 40, minWidth: 52, border: 0, fontFamily: F.sans, fontSize: 17, fontWeight: 700, cursor: "pointer", background: on ? C.ink : "transparent", color: on ? C.page : C.ink }}
              >
                {h === "USDC" ? "$" : "€"}
              </button>
            );
          })}
        </div>
      </div>
      {home === "EURC" && <span style={{ fontSize: 14, color: C.muted }}>{rate ? `${rateText(rate)}, Circle's rate. Pots still pay in USDC.` : "Looking up the rate…"}</span>}
    </div>
  );
}

/** Refund guarantees from HonorCat's first product, only for accounts that have any. */
function Guarantees({ account }: { account: string }) {
  const { data } = usePolling<{ guarantees: { id: string; merchantName: string; promise: string }[] }>(`/api/accounts/${account}`, 60_000);
  if (!data?.guarantees?.length) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 28, fontWeight: 600 }}>Your guarantees</h2>
      {data.guarantees.map((g) => (
        <Link key={g.id} href={`/g/${g.id}`} style={{ fontSize: 16 }}>
          {g.merchantName}: {g.promise}
        </Link>
      ))}
    </section>
  );
}
