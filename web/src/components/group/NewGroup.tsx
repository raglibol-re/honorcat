"use client";

import { FeeNote, useFees } from "@/components/pot/Receipts";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { closesIn, MarketList, type MarketItem } from "@/components/cat/Markets";
import { C, F } from "@/components/cat/tokens";
import { GeminiLink } from "@/components/cat/GeminiLink";
import { SignIn, useActor } from "@/components/pot/Who";
import { ActionProgress, Button } from "@/components/ui/Button";
import { Input, Notice } from "@/components/ui/Field";
import { money } from "@/lib/currency";
import { createGroup, joinTeam, prepareGroup, setTeamLines } from "@/lib/group";
import { plainError } from "@/lib/messages";

const h2 = { margin: 0, fontFamily: F.cond, fontSize: 30, fontWeight: 600 } as const;
const label = { display: "flex", flexDirection: "column", gap: 6, fontSize: 16, flex: "1 1 240px" } as const;

/**
 * Start a group: a market, both team names with a short line each, and (optionally) the creator's
 * own first join. Opening the group moves no money; the join is a second confirmation.
 */
export function NewGroup() {
  const router = useRouter();
  const who = useActor();
  const fees = useFees();
  const [market, setMarket] = useState<MarketItem | null>(null);
  const [names, setNames] = useState<[string, string]>(["", ""]);
  const [lines, setLines] = useState<[string, string]>(["", ""]);
  const [team, setTeam] = useState<0 | 1>(0);
  const [stake, setStake] = useState("5");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amount = (() => {
    const v = Number(stake.replace(",", "."));
    return Number.isFinite(v) && v > 0 ? BigInt(Math.round(v * 1e6)) : 0n;
  })();
  const clean = names.map((n) => n.trim()) as [string, string];
  const why = !market
    ? "Pick a market first."
    : !clean[0] || !clean[1]
      ? "Name both teams."
      : clean[0].toLowerCase() === clean[1].toLowerCase()
        ? "The two teams need different names."
        : clean[0].length > 40 || clean[1].length > 40
          ? "Team names are at most 40 characters."
          : amount > 0n && amount < 100_000n
            ? "The smallest join is $0.10 (or leave it empty to only open the group)."
            : null;

  const start = async () => {
    if (!who.actor || !market) return;
    setBusy(true);
    setErr(null);
    try {
      setStep("Reading the market's depth");
      const prep = await prepareGroup(market.symbol, who.actor.account);
      const r = await createGroup(who.actor, prep, clean, setStep);
      if (!r.groupId) throw new Error("The group opened, but its number did not come back yet. Look under Groups in a moment.");
      const gid = r.groupId;
      if (lines[0].trim() || lines[1].trim()) await setTeamLines(who.actor, gid, lines).catch(() => {});
      // The group exists now: whatever happens to the first join, go to its page (never open a second group).
      let joinErr: string | null = null;
      if (amount > 0n) await joinTeam(who.actor, prep.groups, gid, team, amount, true, setStep).catch((e) => (joinErr = plainError(e)));
      router.push(`/groups/${gid}?team=${team}${joinErr ? `&joinfailed=${encodeURIComponent(joinErr)}` : ""}`);
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>1. The market</h2>
        {market ? (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong style={{ fontSize: 18 }}>
              {market.eventTitle}
              {market.label ? ` · ${market.label}` : ""}
            </strong>
            <GeminiLink ticker={market.eventTicker} slug={market.slug} label="See this market on Gemini" />
            <span style={{ color: C.muted }}>trading closes in {closesIn(market.closeMs)}</span>
            <button type="button" onClick={() => setMarket(null)} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", fontSize: 16, padding: 0, minHeight: 44 }}>
              Change
            </button>
          </div>
        ) : (
          <MarketList picked={null} onPick={setMarket} />
        )}
      </section>

      {market && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={h2}>2. The teams</h2>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[0, 1].map((t) => (
              <div key={t} style={{ ...label, border: `1.5px solid ${C.ink}`, padding: 14 }}>
                <strong>{t === 0 ? "The yes side" : "The no side"}</strong>
                <label style={label}>
                  Team name
                  <Input value={names[t]} maxLength={40} placeholder={t === 0 ? "Texas fans" : "Arkansas fans"} onChange={(e) => setNames((n) => (t === 0 ? [e.target.value, n[1]] : [n[0], e.target.value]))} />
                </label>
                <label style={label}>
                  A short line (optional)
                  <Input value={lines[t]} maxLength={80} placeholder={t === 0 ? "Hook 'em" : "Woo pig"} onChange={(e) => setLines((n) => (t === 0 ? [e.target.value, n[1]] : [n[0], e.target.value]))} />
                </label>
              </div>
            ))}
          </div>
        </section>
      )}

      {market && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={h2}>3. Your own join</h2>
          <div role="radiogroup" aria-label="Your team" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[0, 1].map((t) => (
              <button key={t} type="button" role="radio" aria-checked={team === t} className="hc-choice" onClick={() => setTeam(t as 0 | 1)} style={{ flex: "1 1 200px", padding: "12px 14px" }}>
                <strong style={{ fontFamily: F.cond, fontSize: 24 }}>{clean[t] || (t === 0 ? "Yes team" : "No team")}</strong>
              </button>
            ))}
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 17 }}>
            Amount in $ <Input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} style={{ width: 110 }} />
          </label>
          <p style={{ margin: 0, fontSize: 16, color: C.body }}>
            {amount > 0n
              ? `Your ${money(amount)} joins in the first clearing at the price of that window. Until the other team has members, it waits (up to 20 minutes), then comes back.`
              : "Leave it empty to only open the group and share the join links."}
          </p>
          {!who.actor ? (
            <SignIn who={who} purpose="Sign in to start a group." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <Button busy={busy} disabled={busy || Boolean(why)} onClick={start}>
                  Open the group
                </Button>
              </div>
              {why && <p style={{ margin: 0, fontSize: 15, color: C.muted }}>{why}</p>}
              <ActionProgress step={step} />
              <FeeNote fees={fees} kind="pot_exec" payer={who.actor?.kind === "wallet" ? "wallet" : "honorcat"} />
            </div>
          )}
          {err && (
            <Notice tone="error" role="alert">
              {err}
            </Notice>
          )}
        </section>
      )}
    </div>
  );
}
