"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { C, F } from "@/components/cat/tokens";
import { HelperCat } from "@/components/helper/Helper";
import { btn, btnQuiet, type ActorState } from "@/components/pot/Who";
import { attachSitter, CAN_BE_ALONE, cleanPowers, decideProposal, detachSitter, POWER_KEYS, POWER_LABEL, seatsOf, signExitInAdvance, type AgentInfo, type Power, type Powers, type SeatView } from "@/lib/agent";
import { getJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { requestExit, setLevels, signHandshake, type HcPot } from "@/lib/hc";
import { plainError } from "@/lib/messages";

/** Postgres timestamps ("2026-11-16 22:30:24.74+00") as milliseconds, in every browser. */
const ts = (v: string) => Date.parse(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));

const ACTION_WORDS: Record<string, string> = {
  take_side: "took the other side",
  set_net: "set a net",
  set_bowl: "set a bowl",
  request_exit: "asked to leave",
  offer_handshake: "offered a handshake",
  accept_handshake: "accepted a handshake",
};
const describe = (action: string, args?: { percent?: number; part?: string }) =>
  action === "set_net" || action === "set_bowl"
    ? `${action === "set_net" ? "a net" : "a bowl"} at ${args?.percent}%`
    : action === "request_exit"
      ? args?.part === "partial"
        ? "a partial exit (one ninth)"
        : "a full exit"
      : "accepting the handshake";

/**
 * Agents on this pot: the label ("minded by a cat sitter" or "played by an agent"), every action
 * the agent took with its own one-line reason, the sitter's proposals for the player to confirm,
 * and, for the player's own live pot, the form to let their cat sitter mind it.
 */
export function AgentPanel({ pot, who, agent, mySide, pots }: { pot: HcPot; who: ActorState; agent: AgentInfo | null | undefined; mySide: number | null; pots: Address }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (k: string, f: () => Promise<unknown>, ok?: string) => {
    setBusy(k);
    setErr(null);
    setNote(null);
    try {
      await f();
      if (ok) setNote(ok);
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(null);
    }
  };
  const me = who.actor;
  // Proposals only make sense while the pot is live; afterwards they lapse.
  const pending = pot.state === "Live" ? (agent?.proposals ?? []).filter((p) => p.status === "pending") : [];
  const isOwner = mySide !== null && !!me;

  const approve = (p: AgentInfo["proposals"][number]) =>
    run(
      `p${p.id}`,
      async () => {
        const side = mySide!;
        const lv = (pot.data.levels?.[side] as { net: number; bowl: number } | null | undefined) ?? { net: 0, bowl: 0 };
        if (p.action === "set_net") await setLevels(me!, pots, pot, side, Math.round((p.args.percent ?? 0) * 10_000), lv.bowl);
        else if (p.action === "set_bowl") await setLevels(me!, pots, pot, side, lv.net, Math.round((p.args.percent ?? 0) * 10_000));
        else if (p.action === "request_exit") {
          const n = BigInt(pot.data.notional);
          const initial = BigInt((pot.data as { initialNotional?: string }).initialNotional ?? pot.data.notional);
          await requestExit(me!, pots, pot, side, p.args.part === "partial" ? (initial / 9n > n ? n : initial / 9n) : n);
        } else if (p.action === "accept_handshake") {
          const offers = await getJson<{ offers: { side: number; price_yes: number; notional: string; deadline: string }[] }>(`/api/hc/pots/${pot.potId}/handshake`);
          const other = offers.offers.find((o) => o.side !== side);
          if (!other) throw new Error("The other side's handshake offer has expired.");
          const sig = await signHandshake(me!, pots, pot, other.price_yes, BigInt(other.notional), BigInt(other.deadline));
          await getJson(`/api/hc/pots/${pot.potId}/handshake`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ side, priceYes: other.price_yes, notional: other.notional, deadline: Number(other.deadline), signature: sig }),
          });
        }
        await decideProposal(p.id, "approved");
      },
      "Done: you confirmed the cat sitter's proposal.",
    );

  if (!agent?.sitter && !agent?.opponent && !agent?.actions.length && !(isOwner && pot.state === "Live")) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
      {(agent?.sitter || agent?.opponent) && (
        <div role="note" style={{ display: "flex", alignItems: "center", gap: 12, border: `1.5px solid ${C.ink}`, padding: "10px 14px" }}>
          <HelperCat pose={agent.sitter ? "sit" : "point"} size={64} label={agent.sitter ? "A cat sitter minding this pot" : "An agent playing the other side"} />
          <span style={{ fontSize: 17, lineHeight: 1.45 }}>
            {agent.sitter ? (
              <>
                <strong>Minded by a cat sitter:</strong> {agent.sitter.label}, an agent the player let in. It acts alone only on exits signed in advance; everything else waits for the player.
              </>
            ) : (
              <>
                <strong>Played by an agent:</strong> {agent.opponent!.label} holds the other side with HonorCat&apos;s practice wallet. Practice pot, test money, out of honor records.
              </>
            )}
          </span>
        </div>
      )}

      {isOwner && pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 style={{ margin: 0, fontFamily: F.cond, fontSize: 28, fontWeight: 600 }}>Your cat sitter asks</h3>
          {pending.map((p) => (
            <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 6, borderLeft: `3px solid ${C.ink}`, paddingLeft: 12 }}>
              <span style={{ fontSize: 17 }}>
                <strong>{describe(p.action, p.args)}</strong>: “{p.reason}”
              </span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" style={{ ...btn, minHeight: 42, fontSize: 16 }} disabled={!!busy} onClick={() => approve(p)}>
                  {busy === `p${p.id}` ? "Confirm…" : "Confirm"}
                </button>
                <button type="button" style={{ ...btnQuiet, minHeight: 42, fontSize: 16 }} disabled={!!busy} onClick={() => run(`d${p.id}`, () => decideProposal(p.id, "declined"), "Declined.")}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(agent?.actions.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 style={{ margin: 0, fontFamily: F.cond, fontSize: 26, fontWeight: 600 }}>What the agent did</h3>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1px solid ${C.faint}` }}>
            {agent!.actions.map((a, i) => (
              <li key={i} style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", padding: "8px 0", borderBottom: `1px solid ${C.faint}`, fontSize: 15 }}>
                <span style={{ color: C.muted, minWidth: 140 }}>{formatDate(ts(a.at))}</span>
                <span>
                  <strong>{a.label}</strong> (agent) {a.ok ? (/proposed/.test(a.detail ?? "") ? `proposed: ${ACTION_WORDS[a.action] ?? a.action}` : ACTION_WORDS[a.action] ?? a.action) : `tried to ${a.action.replace(/_/g, " ")} and was refused`}
                  {a.reason ? `: “${a.reason}”` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isOwner && pot.state === "Live" && (agent?.sitter ? (
        <button type="button" style={{ ...btnQuiet, alignSelf: "flex-start", minHeight: 40, fontSize: 15 }} disabled={!!busy} onClick={() => run("detach", () => detachSitter(me!.account, pot.potId), "The cat sitter no longer minds this pot.")}>
          Send the cat sitter away
        </button>
      ) : (
        <AttachSitter pot={pot} who={who} mySide={mySide!} pots={pots} busy={busy} run={run} />
      ))}
      {note && <p style={{ margin: 0 }} aria-live="polite">{note}</p>}
      {err && (
        <p role="alert" style={{ margin: 0, color: C.signalInk }}>
          {err}
        </p>
      )}
    </section>
  );
}

function AttachSitter({ pot, who, mySide, pots, busy, run }: { pot: HcPot; who: ActorState; mySide: number; pots: Address; busy: string | null; run: (k: string, f: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [seats, setSeats] = useState<SeatView[]>([]);
  const [seatId, setSeatId] = useState("");
  const [open, setOpen] = useState(false);
  const [powers, setPowers] = useState<Powers>({ setNet: "approval", setBowl: "approval", partialExit: "approval", fullExit: "off", acceptHandshake: "approval" });
  const me = who.actor!;
  useEffect(() => {
    let alive = true;
    seatsOf(me.account)
      .then((r) => {
        if (!alive) return;
        const active = r.seats.filter((s) => s.active);
        setSeats(active);
        if (active[0]) setSeatId(active[0].id);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me.account]);
  if (!seats.length) return null;
  const seat = seats.find((s) => s.id === seatId) ?? seats[0]!;

  const attach = () =>
    run(
      "attach",
      async () => {
        const p = cleanPowers(powers);
        const deadline = Math.floor(ts(seat.expiresAt) / 1000);
        const n = BigInt(pot.data.notional);
        const initial = BigInt((pot.data as { initialNotional?: string }).initialNotional ?? pot.data.notional);
        const ninth = initial / 9n > n ? n : initial / 9n;
        const exits: { full?: { sig: `0x${string}`; notional: string; deadline: number }; partial?: { sig: `0x${string}`; notional: string; deadline: number } } = {};
        if (p.fullExit === "alone") exits.full = { sig: await signExitInAdvance(me, pots, pot.potId, mySide, n, deadline), notional: n.toString(), deadline };
        if (p.partialExit === "alone") exits.partial = { sig: await signExitInAdvance(me, pots, pot.potId, mySide, ninth, deadline), notional: ninth.toString(), deadline };
        await attachSitter(me, { seatId: seat.id, potId: pot.potId, powers: p, exits });
      },
      "Your cat sitter minds this pot now. Tell your Grok Bot: “mind my HonorCat pot”.",
    );

  if (!open)
    return (
      <button type="button" style={{ ...btnQuiet, alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        Let my cat sitter mind this pot
      </button>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, border: `1.5px solid ${C.ink}`, padding: "12px 14px" }}>
      <strong style={{ fontFamily: F.cond, fontSize: 26, fontWeight: 600 }}>Let your cat sitter mind this pot</strong>
      {seats.length > 1 && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15 }}>
          Seat
          <select value={seat.id} onChange={(e) => setSeatId(e.target.value)} style={{ minHeight: 40, border: `1.5px solid ${C.ink}`, background: C.page }}>
            {seats.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <table style={{ borderCollapse: "collapse", fontSize: 15 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 10px 4px 0" }}>Action</th>
            {(["alone", "approval", "off"] as Power[]).map((v) => (
              <th key={v} style={{ padding: "4px 8px", fontWeight: 600 }}>
                {v === "alone" ? "Alone" : v === "approval" ? "With my approval" : "Never"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {POWER_KEYS.map((k) => (
            <tr key={k} style={{ borderTop: `1px solid ${C.faint}` }}>
              <td style={{ padding: "6px 10px 6px 0" }}>{POWER_LABEL[k]}</td>
              {(["alone", "approval", "off"] as Power[]).map((v) => {
                const disabled = v === "alone" && !CAN_BE_ALONE.includes(k);
                return (
                  <td key={v} style={{ textAlign: "center" }}>
                    <input
                      type="radio"
                      name={`power-${k}`}
                      aria-label={`${POWER_LABEL[k]}: ${v}`}
                      checked={powers[k] === v}
                      disabled={disabled}
                      onChange={() => setPowers({ ...powers, [k]: v })}
                      style={{ width: 20, height: 20 }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: 0, fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
        Alone works only for exits: you sign them now, they expire with the seat ({formatDate(ts(seat.expiresAt))}), and using one cancels the other. Nets, bowls and handshakes always wait for
        you. The cat sitter never withdraws and never touches your other pots.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" style={btn} disabled={!!busy} onClick={attach}>
          {busy === "attach" ? "Confirm…" : "Let it mind this pot"}
        </button>
        <button type="button" style={btnQuiet} onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}
