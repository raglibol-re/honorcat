import { Suspense } from "react";
import { connection } from "next/server";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { getConfig, getDb, getPotDetail } from "@/server/relay";
import { impliedChance, listActiveEvents, questionToClause } from "@/server/gemini";
import { GuaranteeCard, type GuaranteeCardData } from "@/components/guarantee/GuaranteeCard";
import { RAIL_LABELS, type RailStep } from "@/components/guarantee/SettlementRail";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata = { title: "Design preview · Verdict Guarantees" };

const TOKENS: [string, string, string][] = [
  ["page", "#f4f6f5", "#0d1110"],
  ["card", "#ffffff", "#151a19"],
  ["ink", "#111615", "#ecf1ef"],
  ["muted", "#58625f", "#9ba6a2"],
  ["rule", "#d5dcd9", "#29312f"],
  ["accent", "#0a6a62", "#5cc6b6"],
  ["accent-soft", "#e2f0ed", "#12302c"],
];

const SCALE: [string, string, string][] = [
  ["t-36", "36 / 40", "Amounts on the card"],
  ["t-27", "27 / 34", "Page titles"],
  ["t-21", "21 / 28", "The promise"],
  ["t-17", "17 / 25", "Lead text"],
  ["t-15", "15 / 22", "Body"],
  ["t-13", "13 / 18", "Labels and notes"],
];

async function sampleCards(): Promise<{ cards: Record<"active" | "refunded" | "not_triggered", GuaranteeCardData>; source: string }> {
  await connection();
  // Live market: the soonest weather market with a two-sided quote on an "above" threshold.
  const events = await listActiveEvents("Weather").catch(() => []);
  const now = Date.now();
  let pick: { title: string; ticker: string; label: string; chance: number | null; expiry: string } | null = null;
  // Prefer the two-sided "above" contract whose chance is closest to 50%: the most informative example.
  for (const e of events) {
    if (!e.expiryDate || new Date(e.expiryDate).getTime() < now + 3_600_000) continue;
    for (const c of e.contracts) {
      if (c.strike?.type !== "above" || !c.prices?.bestBid || !c.prices?.bestAsk) continue;
      const chance = impliedChance(c.prices);
      if (chance === null) continue;
      if (!pick || Math.abs(chance - 0.5) < Math.abs((pick.chance ?? 0) - 0.5)) {
        pick = { title: e.title, ticker: `${e.ticker}:${c.ticker}`, label: c.label, chance, expiry: e.expiryDate };
      }
    }
  }
  pick ??= {
    title: "Highest temperature in Denver on November 15, 2026?",
    ticker: "—",
    label: "63°F or above",
    chance: null,
    expiry: new Date(now + 86_400_000).toISOString(),
  };

  // Real chain data: pot #14 on the deployed vault (a settled pot with a payout).
  const cfg = getConfig();
  const detail = await getPotDetail(await getDb(), 14).catch(() => null);
  const ev = (name: string) => detail?.events.find((e) => e.name === name);
  const step = (key: RailStep["key"], e?: { txHash: string; blockNumber: number; time: number | null }): RailStep => ({
    key,
    label: RAIL_LABELS[key],
    done: Boolean(e),
    tx: e?.txHash,
    block: e?.blockNumber,
    time: e?.time ?? undefined,
  });
  const created = ev("PotCreated");
  const funded = ev("PotFunded");
  const resolved = ev("PotResolved");
  const paid = ev("Payout");

  const promise = `If ${questionToClause(pick.title)} is ${pick.label}, Mesa Trail Tours refunds your 5.00 USDC tour fee.`;
  const base: Omit<GuaranteeCardData, "state" | "steps"> = {
    merchant: "Mesa Trail Tours",
    promise,
    refundUsdc: "5000000",
    chance: pick.chance,
    settlesAt: pick.expiry,
    seat: { n: 3, of: 50 },
    account: "0x8f3C0bA4b6c2E1D9A7f05c3E9b1d2A4c5E6f7a21",
    lockedUsdc: detail?.pot.total ?? "250000000",
    potId: detail?.pot.potId ?? 14,
    vault: cfg.vault,
  };
  return {
    source: pick.ticker,
    cards: {
      active: { ...base, state: "active", steps: [step("locked", created), step("enrolled", funded), step("event"), step("verdict"), step("paid")] },
      refunded: {
        ...base,
        state: "refunded",
        reason: `Gemini settled "${pick.label}" as YES for ${questionToClause(pick.title)}.`,
        steps: [step("locked", created), step("enrolled", funded), step("event", resolved), step("verdict", resolved), step("paid", paid)],
      },
      not_triggered: {
        ...base,
        state: "not_triggered",
        reason: `Gemini settled "${pick.label}" as NO. The merchant's deposit went back to them.`,
        steps: [step("locked", created), step("enrolled", funded), step("event", resolved), step("verdict", resolved), step("paid", resolved)],
      },
    },
  };
}

async function Cards() {
  const { cards, source } = await sampleCards();
  return (
    <>
      <p className="t-13 mt-2" style={{ color: "var(--vg-muted)" }}>
        Live market <span className="mono">{source}</span> from Gemini. Chain data from pot #14 on the deployed vault. Merchant,
        refund amount and seat are illustrative.
      </p>
      {(["light", "dark"] as const).map((theme) => (
        <div key={theme} className={`vg vg-${theme} mt-6 rounded-2xl px-4 py-8 sm:px-8`}>
          <h3 className="t-15 mb-5 font-medium" style={{ color: "var(--vg-muted)" }}>
            {theme === "light" ? "Light" : "Dark"}
          </h3>
          <div className="grid justify-items-center gap-8 lg:grid-cols-3 lg:items-start">
            <GuaranteeCard g={cards.active} />
            <GuaranteeCard g={cards.refunded} canWithdraw />
            <GuaranteeCard g={cards.not_triggered} />
          </div>
        </div>
      ))}
    </>
  );
}

export default function DesignPreview() {
  return (
    <div className={`${plexSans.variable} ${plexMono.variable} vg -mx-4 -my-10 px-4 py-10 sm:px-8`}>
      <div className="mx-auto max-w-6xl">
        <p className="t-13 mb-6 rounded-lg px-4 py-3" style={{ background: "var(--vg-warn-bg)", color: "var(--vg-warn-ink)" }}>
          Arc testnet. Test funds only. A demo of conditional refunds, not insurance; no real hedge is placed.
        </p>
        <h1 className="t-27 font-semibold">Verdict Guarantees: design preview</h1>
        <p className="t-17 mt-2 max-w-2xl" style={{ color: "var(--vg-muted)" }}>
          Tokens and the customer card, for approval before the other pages are built.
        </p>

        <section className="mt-10 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="t-17 font-medium">Colour</h2>
            <table className="t-13 mt-3 w-full">
              <thead style={{ color: "var(--vg-muted)" }}>
                <tr className="text-left">
                  <th className="pb-2 font-normal">Token</th>
                  <th className="pb-2 font-normal">Light</th>
                  <th className="pb-2 font-normal">Dark</th>
                </tr>
              </thead>
              <tbody>
                {TOKENS.map(([name, light, dark]) => (
                  <tr key={name} className="border-t" style={{ borderColor: "var(--vg-rule)" }}>
                    <td className="py-2">{name}</td>
                    {[light, dark].map((hex) => (
                      <td key={hex} className="py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-4 w-4 rounded border" style={{ background: hex, borderColor: "var(--vg-rule)" }} />
                          <span className="mono">{hex}</span>
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="t-13 mt-3" style={{ color: "var(--vg-muted)" }}>
              One accent, ink teal, for money that is locked or paid. &quot;Not triggered&quot; stays neutral: nothing went wrong.
            </p>
          </div>
          <div>
            <h2 className="t-17 font-medium">Type</h2>
            <p className="t-13 mt-1" style={{ color: "var(--vg-muted)" }}>
              IBM Plex Sans for text, IBM Plex Mono for amounts, hashes and blocks.
            </p>
            <ul className="mt-3 space-y-3">
              {SCALE.map(([cls, size, use]) => (
                <li key={cls} className="flex items-baseline justify-between gap-4 border-t pt-2" style={{ borderColor: "var(--vg-rule)" }}>
                  <span className={cls}>{use}</span>
                  <span className="mono t-13 shrink-0" style={{ color: "var(--vg-muted)" }}>
                    {size}
                  </span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-4 border-t pt-2" style={{ borderColor: "var(--vg-rule)" }}>
                <span className="mono t-21">5.00 · 0x3e2c…0b41 · #72,348,034</span>
                <span className="mono t-13" style={{ color: "var(--vg-muted)" }}>
                  mono
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="t-17 font-medium">Customer card: active, refunded, not triggered</h2>
          <Suspense fallback={<p className="t-13 mt-4">Loading live market…</p>}>
            <Cards />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
