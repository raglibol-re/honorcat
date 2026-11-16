"use client";

import { CatState } from "@/components/cat/CatState";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Cat } from "@/components/cat/Cat";
import { MarketList, type MarketItem } from "@/components/cat/Markets";
import { C, F } from "@/components/cat/tokens";
import { Reliability } from "@/components/pot/Reliability";
import { useLivePrice } from "@/components/pot/usePrice";
import { AccountLine, FundsHelp, btn, btnQuiet, SignIn, useActor } from "@/components/pot/Who";
import { getJson, usePolling } from "@/lib/api";
import { displayName, useNames } from "@/lib/names";
import { useTechMode } from "@/components/TechMode";
import { createPot, joinPot, prepare, worstCase, YES, type HcPot } from "@/lib/hc";
import { sidesOf } from "@/lib/statement";

const POTS = "0xc890C990048f45cb268d076E4A3dB25270Ea1e59" as const;
const TOLERANCE = 50_000;
const h2: React.CSSProperties = { margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 };
const input: React.CSSProperties = { minHeight: 48, padding: "0 12px", border: `1.5px solid ${C.ink}`, background: C.page, fontFamily: F.sans, fontSize: 18, color: C.ink, width: 160, boxSizing: "border-box" };

type SeatView = { account: string; kind: "passkey" | "wallet" } | null;
type Draft = {
  id: string;
  host: SeatView;
  guest: SeatView;
  hostSide: 0 | 1;
  symbol: string | null;
  label: string | null;
  notional: string;
  graceDays: number;
  version: number;
  guestAgreed: number | null;
  potId: string | null;
  status: "open" | "created" | "joined";
};

const KEY = (id: string) => `honorcat.draft.${id}`;
export const saveSeat = (id: string, token: string) => {
  try {
    localStorage.setItem(KEY(id), token);
  } catch {
    /* private mode: the seat lasts for this tab */
  }
};
const loadSeat = (id: string) => {
  try {
    return localStorage.getItem(KEY(id));
  } catch {
    return null;
  }
};
const post = <T,>(path: string, body: unknown) => getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The shared draft two friends edit together, then each put in their side with one confirmation. */
export function Together({ id }: { id: string }) {
  const who = useActor();
  const router = useRouter();
  const { data: draft, error } = usePolling<Draft>(`/api/hc/drafts/${id}`, 2000);
  const [token, setToken] = useState<string | null>(null);
  const [mine, setMine] = useState<Draft | null>(null); // the latest copy after my own change
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => setToken(loadSeat(id)));
  }, [id]);

  const d = mine && draft && mine.version > draft.version ? mine : draft;
  const { tech } = useTechMode();
  const names = useNames([d?.host?.account, d?.guest?.account]);
  const nm = (a: string) => displayName(a, names, null, tech, "your friend");
  const live = useLivePrice(d?.symbol ?? null);

  if (!d) return error ? <CatState kind="error" text={error} /> : <CatState kind="loading" />;

  const me = who.actor?.account?.toLowerCase() ?? null;
  const isHost = !!token && !!d.host && d.host.account.toLowerCase() === me;
  const isGuest = !!token && !!d.guest && d.guest.account.toLowerCase() === me;
  // With a seat token but not signed in yet: show the draft and ask to sign in.
  const mySeat = token ? (isHost ? "host" : isGuest ? "guest" : who.actor ? "other" : "pending") : null;
  const mySide = isHost ? d.hostSide : isGuest ? 1 - d.hostSide : null;
  const n = BigInt(d.notional);
  const p = live.smoothed;
  const center = p === null ? null : Math.round(p * 1e6);
  const hostPays = center === null ? null : worstCase(d.hostSide, n, center, TOLERANCE);
  const guestPays = center === null ? null : worstCase(1 - d.hostSide, n, center, TOLERANCE);
  const agreed = d.guestAgreed === d.version;

  const run = async (f: () => Promise<void>) => {
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStep(null);
    }
  };
  const act = (body: Record<string, unknown>) =>
    run(async () => {
      const r = await post<{ draft: Draft }>(`/api/hc/drafts/${id}`, { ...body, token });
      setMine(r.draft);
    });

  /* ------------------------------------------------------------ not seated yet */
  if (!token || mySeat === "other") {
    if (d.guest && !token)
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
          <Cat pose="second" size={220} />
          <p style={{ fontSize: 19 }}>This pot already has its two friends.</p>
          <Link href="/pots/together">Start your own with a friend</Link>
        </div>
      );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 680 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 56, fontWeight: 600, lineHeight: 0.95 }}>{d.host ? `${nm(d.host.account)} invites you to a pot` : "A pot for two"}</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body }}>
          You pick the question and the sides together. Then each of you puts in your side once; the starting split is the market&apos;s price at that moment.
        </p>
        {!who.actor ? (
          <SignIn who={who} purpose="Your account holds your side of the pot. A passkey on this device is enough; HonorCat pays the network fees." />
        ) : (
          <>
            <AccountLine who={who} />
            <button
              type="button"
              style={{ ...btn, alignSelf: "flex-start" }}
              onClick={() =>
                run(async () => {
                  const r = await post<{ token: string; draft: Draft }>(`/api/hc/drafts/${id}`, { action: "sit", account: who.actor!.account, kind: who.actor!.kind });
                  saveSeat(id, r.token);
                  setToken(r.token);
                  setMine(r.draft);
                })
              }
            >
              Take the other seat
            </button>
          </>
        )}
        {err && <p role="alert" style={{ margin: 0, color: C.signalInk }}>{err}</p>}
      </div>
    );
  }

  /* ------------------------------------------------------------ seated */
  const other = isHost ? d.guest : d.host;
  const editable = !d.potId;
  // The draft's label is "Event: Result"; each side by the statement it stands for.
  const lab = d.label ?? "";
  const cut = lab.lastIndexOf(": ");
  const st = lab ? sidesOf({ eventTitle: cut > 0 ? lab.slice(0, cut) : lab, label: cut > 0 ? lab.slice(cut + 2) : lab }) : null;
  const sideName = (s: number) => (st ? `“${s === YES ? st.yes : st.no}”` : s === YES ? "YES" : "NO");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 56, fontWeight: 600, lineHeight: 0.95 }}>A pot for two</h1>
        <p style={{ margin: 0, fontSize: 18, color: C.body }}>
          You ({isHost ? "started it" : "invited"}) and {other ? nm(other.account) : "a friend, once they open the link"}. Changes show up for both of you within seconds.
        </p>
        {!who.actor && <SignIn who={who} purpose="Sign in with the account you sat down with." />}
      </header>

      {isHost && !d.guest && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={h2}>Invite your friend</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={btn}
              onClick={async () => {
                const url = location.href;
                if (navigator.share) await navigator.share({ title: "HonorCat pot", text: "Start a pot with me on HonorCat", url }).catch(() => {});
                else await navigator.clipboard?.writeText(url);
              }}
            >
              Share the link
            </button>
            <button type="button" style={btnQuiet} onClick={() => navigator.clipboard?.writeText(location.href)}>
              Copy the link
            </button>
          </div>
          <p style={{ margin: 0, color: C.muted }}>You can already pick the question while you wait.</p>
        </section>
      )}

      {/* the terms both edit */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={h2}>The question</h2>
        {d.symbol && !picking ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, padding: "14px 0" }}>
            <span style={{ fontSize: 20, fontWeight: 600 }}>{d.label}</span>
            <span style={{ color: C.muted }}>{p === null ? "" : `${(p * 100).toFixed(1)}% chance now`}</span>
            {editable && (
              <button type="button" onClick={() => setPicking(true)} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", fontSize: 16, padding: 0 }}>
                Change
              </button>
            )}
          </div>
        ) : editable ? (
          <MarketList
            picked={d.symbol}
            onPick={(m: MarketItem) => {
              setPicking(false);
              void act({ action: "terms", symbol: m.symbol, label: `${m.eventTitle}: ${m.label}` });
            }}
          />
        ) : null}
        {d.symbol && <Reliability symbol={d.symbol} />}
      </section>

      {d.symbol && (
        <section style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
          <h2 style={h2}>Sides and size</h2>
          <div role="radiogroup" aria-label="Your side" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[YES, 1].map((s) => {
              const hostTakes = s;
              const youTake = isHost ? s : 1 - s;
              const on = d.hostSide === hostTakes;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!editable}
                  onClick={() => act({ action: "terms", hostSide: hostTakes })}
                  style={{ ...btn, flex: "1 1 260px", background: on ? C.ink : "transparent", color: on ? C.page : C.ink, border: `1.5px solid ${C.ink}`, fontSize: 16 }}
                >
                  You take {sideName(youTake)}
                </button>
              );
            })}
          </div>
          <label style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>Pot size (USDC, up to $25)</span>
            <input
              style={input}
              inputMode="decimal"
              disabled={!editable}
              value={amount ?? (Number(d.notional) / 1e6).toString()}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => {
                if (amount === null) return;
                const v = BigInt(Math.round((Number(amount) || 0) * 1e6));
                setAmount(null);
                if (v.toString() !== d.notional) void act({ action: "terms", notional: v.toString() });
              }}
            />
          </label>
          {hostPays !== null && guestPays !== null && mySide !== null && (
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: C.body }}>
              You take <strong>{sideName(mySide)}</strong> and put in up to <strong>${(Number(isHost ? hostPays : guestPays) / 1e6).toFixed(2)}</strong>;{" "}
              {other ? nm(other.account) : "your friend"} up to ${(Number(isHost ? guestPays : hostPays) / 1e6).toFixed(2)}. The starting split is the market&apos;s 30-second average
              when your friend puts in their side (now about {p === null ? "…" : `${(p * 100).toFixed(1)}%`} chance); anything above each share comes straight back. After that, each
              side&apos;s share follows the price, either of you can leave at it, and Gemini&apos;s result decides the rest. The leaving side pays a 1% fee to the other.
            </p>
          )}
        </section>
      )}

      {/* agreement and money, one confirmation each */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
        <h2 style={h2}>Put it in</h2>
        {who.actor && <AccountLine who={who} />}
        <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6, fontSize: 17 }}>
          <li style={{ color: d.guest ? C.ink : C.muted }}>{d.guest ? "Both seats taken." : "Your friend opens the link and takes the other seat."}</li>
          <li style={{ color: agreed || d.potId ? C.ink : C.muted }}>{agreed || d.potId ? "Your friend agreed to these terms." : "Your friend agrees to the terms as they are."}</li>
          <li style={{ color: d.potId ? C.ink : C.muted }}>{d.potId ? `The host opened pot ${d.potId}.` : "The host opens the pot and puts in their side."}</li>
          <li style={{ color: d.status === "joined" ? C.ink : C.muted }}>{d.status === "joined" ? "Your friend put in their side." : "Your friend puts in the other side."}</li>
        </ol>

        {isGuest && !d.potId && d.symbol && (
          <button type="button" style={{ ...btn, alignSelf: "flex-start" }} disabled={agreed || !!step} onClick={() => act({ action: "agree", version: d.version })}>
            {agreed ? "You agreed. Waiting for the host to open the pot" : "I agree to these terms"}
          </button>
        )}

        {isHost && !d.potId && (
          <button
            type="button"
            style={{ ...btn, alignSelf: "flex-start", opacity: agreed ? 1 : 0.6 }}
            disabled={!agreed || !!step || !who.actor || center === null}
            onClick={() =>
              run(async () => {
                if (who.actor!.account.toLowerCase() !== d.host!.account.toLowerCase()) throw new Error("Sign in with the account that started this draft.");
                setStep("Reading the market's depth");
                const prep = await prepare(d.symbol!, who.actor!.account);
                if (BigInt(prep.cap) < n) throw new Error(`This market's order book allows pots up to $${(Number(prep.cap) / 1e6).toFixed(2)} right now.`);
                const r = await createPot(who.actor!, prep, { side: d.hostSide, notional: n, bandCenter: prep.midPpm ?? center!, tolerance: TOLERANCE, graceDays: d.graceDays }, setStep);
                let potId = r.potId;
                if (!potId) {
                  const mine = await getJson<{ pots: { potId: string }[] }>(`/api/hc/pots?owner=${who.actor!.account}`);
                  potId = mine.pots[0]?.potId ?? null;
                }
                if (!potId) throw new Error("The pot was created but is not indexed yet; refresh in a moment.");
                await act({ action: "created", potId });
              })
            }
          >
            {step ?? (agreed ? `Start the pot and put in up to $${hostPays === null ? "…" : (Number(hostPays) / 1e6).toFixed(2)}` : "Waiting for your friend to agree")}
          </button>
        )}

        {isGuest && d.potId && d.status === "created" && (
          <button
            type="button"
            style={{ ...btn, alignSelf: "flex-start" }}
            disabled={!!step || !who.actor}
            onClick={() =>
              run(async () => {
                if (who.actor!.account.toLowerCase() !== d.guest!.account.toLowerCase()) throw new Error("Sign in with the account you sat down with.");
                const pot = await getJson<HcPot>(`/api/hc/pots/${d.potId}`);
                await joinPot(who.actor!, POTS, pot, setStep);
                setStep(null);
                router.push(`/pots/${d.potId}`);
              })
            }
          >
            {step ?? `Put in my side (up to $${guestPays === null ? "…" : (Number(guestPays) / 1e6).toFixed(2)})`}
          </button>
        )}
        {isHost && d.potId && d.status === "created" && <p style={{ margin: 0, fontSize: 17 }}>Pot {d.potId} is open. Waiting for your friend to put in their side.</p>}
        {d.potId && (
          <Link href={`/pots/${d.potId}`} style={{ fontSize: 17 }}>
            {d.status === "joined" ? `Both in: open pot ${d.potId}` : `See pot ${d.potId}`}
          </Link>
        )}
        {err && <p role="alert" style={{ margin: 0, color: C.signalInk }}>{err}</p>}
        {err?.startsWith("Could not add test money") && who.actor && <FundsHelp account={who.actor.account} reason={err.replace(/^Could not add test money: /, "")} />}
        <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Test version on Arc testnet: test money only. Not financial advice. Play within limits.</p>
      </section>
    </div>
  );
}
