"use client";

import { useState } from "react";
import { C, F } from "@/components/cat/tokens";
import { Rope } from "@/components/pot/Rope";
import { Cat } from "@/components/cat/Cat";
import { GeminiCard } from "@/components/cat/GeminiCard";
import { FURS } from "@/lib/names";
import { RopeControl, ShortRopeNote, type RopeSetting } from "@/components/pot/RopeControl";
import { useNow } from "@/lib/useNow";
import { Receipts } from "@/components/pot/Receipts";

const SAMPLE = [
  { name: "PotCreated", args: { notional: "900000" }, tx: "0x01", at: 100 },
  { name: "Joined", args: { depYes: "540000", depNo: "360000" }, tx: "0x02", at: 140 },
  { name: "ExitRequested", args: { side: "0" }, tx: "0x03", at: 200 },
  { name: "PotDivided", args: { exitSide: "0", notional: "100000", price: "700000", paidYes: "69000", paidNo: "31000", fee: "1000" }, tx: "0x04", at: 238 },
];

const CLOSE_MS = Date.UTC(2026, 11, 31);

/** Short ropes (HonorCat v2) with sample numbers, for approval before v2 is deployed. */
export function RopePreview() {
  const [setting, setSetting] = useState<RopeSetting | null>(null);
  const nowS = Math.floor(useNow() / 1000);
  const h2 = { margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Short ropes</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body, maxWidth: 680 }}>For approval before HonorCat v2 is deployed. Sample numbers, no real pot.</p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 680 }}>
        <h2 style={h2}>On the create page</h2>
        <RopeControl side={0} center={500_000} tolerance={0} stake={1_000_000n} spread={20_000} crypto closeMs={CLOSE_MS} startMs={null} sideName="BTC above $100,000 at 5 pm" onChange={setSetting} />
        <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
          Chosen: {setting ? `${setting.choice.leverage}×, size ${setting.choice.size} hundredths, pot $${(Number(setting.choice.pot) / 1e6).toFixed(2)}` : "…"}
        </p>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>YES 5× at 50: post first at 40, one extra life bought (now at 30)</h2>
        <Rope price={0.47} notional={7_000_000n} names={{ yes: "you", no: "Mia" }} phase="live" posts={{ lower: 0.3, upper: 1, livesYes: 1, livesNo: 0 }} />
        {nowS > 0 && <ShortRopeNote expiry={nowS + 5 * 3600 + 120} nowS={nowS} ended={false} />}
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>A perp&apos;s rope, zoomed to its posts (34 to 67)</h2>
        <Rope
          price={0.505}
          notional={200_000n}
          names={{ yes: "Olive", no: "you (Saffron)" }}
          phase="live"
          posts={{ lower: 0.34, upper: 0.67 }}
          zoom={[0.2575, 0.7525]}
          cats={{ yes: { fur: "ginger", mood: "even", name: "Olive" }, no: { fur: "brown", mood: "even", name: "Saffron" } }}
        />
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>An open pot: one player, one open seat</h2>
        <Rope
          price={0.52}
          notional={4_000_000n}
          names={{ yes: "Sam", no: "open seat" }}
          phase="waiting"
          cats={{ yes: { fur: "ginger", mood: "even", name: "Sam" }, no: null }}
        />
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>Cat cosmetics (unlocked by the honor record)</h2>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
          {(["bell", "scarf", "bow", "hat", "crown"] as const).map((w) => (
            <figure key={w} style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <Cat pose="sit" size={110} fur={FURS.ginger} wear={w} label={w} />
              <figcaption style={{ fontSize: 14 }}>{w}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>Receipt of a partial exit: the leaver, then the other side</h2>
        <Receipts events={SAMPLE} fees={{ "0x04": "5755" }} mySide={0} name={(s) => (s === 0 ? "you" : "Mia")} says={(s) => (s === 0 ? "YES" : "NO")} fur={(s) => (s === 0 ? "#C9682A" : "#5B6B7A")} />
        <Receipts events={SAMPLE} fees={{ "0x04": "5755" }} mySide={1} name={(s) => (s === 0 ? "Sam" : "you")} says={(s) => (s === 0 ? "YES" : "NO")} fur={(s) => (s === 0 ? "#C9682A" : "#5B6B7A")} />
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>The market on Gemini</h2>
        <GeminiCard ticker="BTC05M2611182200" slug="btc-price-today-at-5pm-est" question="BTC above $64,000 at 5 pm?" yes="Above" no="Below" price={0.495} />
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>NO 10× at 50: post at 55, the price beyond it (clamped)</h2>
        <Rope price={0.58} notional={5_500_000n} names={{ yes: "Sam", no: "you" }} phase="live" posts={{ lower: 0, upper: 0.55, livesYes: 0, livesNo: 0 }} />
      </section>
    </div>
  );
}
