import { CatHead } from "./shapes";
import { C, F } from "./tokens";

export const STATE_NAMES = ["Locked", "Armed", "Triggered", "Paid", "Confirmed"] as const;
export type RailStep = { name: (typeof STATE_NAMES)[number]; done: boolean; phrase: string; mono?: string };

/**
 * The five states with a cat phrase underneath (landing reference, #money section). The latest
 * reached state's head is in signal colour, earlier ones ink, later ones an outline; the rule after
 * a head is solid when the next state is reached, dashed while it is pending.
 */
export function StateRail({ steps }: { steps: RailStep[] }) {
  const current = steps.reduce((c, s, i) => (s.done ? i : c), -1);
  return (
    <ol style={{ display: "flex", flexWrap: "wrap", gap: "28px 0", margin: 0, padding: 0, listStyle: "none" }}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const next = steps[i + 1];
        return (
          <li key={s.name} style={{ flex: "1 1 190px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", height: 22 }}>
              {s.done ? <CatHead width={24} height={22} fill={i === current ? C.signal : C.ink} /> : <CatHead width={24} height={22} outline />}
              {last ? (
                <span style={{ flex: 1 }} />
              ) : next?.done ? (
                <span style={{ flex: 1, height: 2, background: C.ink }} />
              ) : (
                <span style={{ flex: 1, height: 0, borderTop: `2px dashed ${C.dash}` }} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingRight: 20 }}>
              <span style={{ fontFamily: F.cond, fontSize: 30, fontWeight: 600, lineHeight: 1 }}>{s.name}</span>
              <span style={{ fontSize: 16, lineHeight: 1.4, color: C.muted }}>{s.phrase}</span>
              {s.mono && <span style={{ fontFamily: F.mono, fontSize: 13, color: C.muted }}>{s.mono}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
