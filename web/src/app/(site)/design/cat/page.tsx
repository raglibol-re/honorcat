import { Cat, POSE_TEXT, type CatPose } from "@/components/cat/Cat";
import { C, F } from "@/components/cat/tokens";
import { HelperBubble, HelperCat } from "@/components/helper/Helper";

export const metadata = { title: "Cat poses" };

const POSES: [CatPose, string][] = [
  ["rope", "Balancing on the rope"],
  ["wobble", "Wobbling (price moving fast)"],
  ["crouch", "Crouching (exit requested)"],
  ["air", "In the air (exit window)"],
  ["land", "Landing on its feet"],
  ["net", "Resting in the net"],
  ["bowl", "Eating at the bowl"],
  ["paw", "Giving a paw (handshake)"],
  ["second", "A second cat (takeover)"],
  ["sleep", "Sleeping (waiting for an opponent)"],
  ["peek", "Peeking in (loading)"],
  ["box", "Looking into an empty box (not found)"],
];

const caption = { margin: 0, fontSize: 14, lineHeight: 1.4, color: C.muted, maxWidth: 240 } as const;

export default function CatPosesPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Cat poses</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body, maxWidth: 680 }}>For approval before use.</p>
      </div>

      <section style={{ borderTop: `1.5px solid ${C.ink}`, paddingTop: 20, display: "flex", flexWrap: "wrap", gap: "36px 48px" }}>
        {POSES.map(([pose, name]) => (
          <figure key={pose} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8, width: 240 }}>
            <div style={{ height: 150, display: "flex", alignItems: "flex-end" }}>
              <Cat pose={pose} size={pose === "second" || pose === "box" ? 230 : 180} />
            </div>
            <figcaption style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{name}</span>
              <span style={{ fontFamily: F.mono, fontSize: 12, color: C.muted }}>pose=&quot;{pose}&quot;</span>
              <p style={caption}>{POSE_TEXT[pose]}</p>
            </figcaption>
          </figure>
        ))}
      </section>

      <section style={{ borderTop: `1.5px solid ${C.ink}`, paddingTop: 20, display: "flex", flexDirection: "column", gap: 20 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>The helper cat</h2>
        <p style={{ ...caption, maxWidth: 640 }}>
          A second cat beside the market cat: a light coat with an ink outline and a signal-coloured collar, so it is never mistaken for a player&apos;s cat. It explains and informs; it never moves money
          and never says which side to take. For approval before use.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "28px 40px" }}>
          {(
            [
              ["corner", "Peeking in from the corner"],
              ["talk", "Talking"],
              ["think", "Thinking"],
              ["shrug", "Shrugging (does not know)"],
              ["point", "Pointing at the rope"],
              ["sit", "Playing the opponent on its post"],
              ["sleep", "Asleep (no AI available, or muted)"],
            ] as const
          ).map(([pose, name]) => (
            <figure key={pose} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8, width: 200 }}>
              <div style={{ height: 140, display: "flex", alignItems: "flex-end" }}>
                <HelperCat pose={pose} size={pose === "corner" ? 120 : 170} />
              </div>
              <figcaption style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{name}</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: C.muted }}>pose=&quot;{pose}&quot;</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>A bubble (what a player sees beside the exit confirmation)</h3>
        <HelperBubble
          lines={[
            "Leaving: about $0.49 for you after a $0.01 treat for Practice cat. The final amount is set by the next 30 seconds and cannot be taken back.",
            "Staying: when Gemini settles, you get $0.65 if Boston beats Orlando, and nothing if not.",
            "Shaking hands: if Practice cat agrees, the pot splits now at 76.5% with no treat.",
          ]}
        />
      </section>

      <section style={{ borderTop: `1.5px solid ${C.ink}`, paddingTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Nine lives</h2>
        <p style={caption}>Partial exits in ninths: filled marks are the lives left.</p>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: 10 }, (_, n) => (
            <li key={n} style={{ display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${C.faint}`, paddingBottom: 8 }}>
              <span style={{ fontFamily: F.mono, fontSize: 13, width: 24, color: C.muted }}>{n}</span>
              <Cat pose="lives" lives={n} size={220} />
            </li>
          ))}
        </ul>
      </section>

      <section style={{ borderTop: `1.5px solid ${C.ink}`, paddingTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 36, fontWeight: 600 }}>Sizes</h2>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 32 }}>
          <Cat pose="rope" size={56} />
          <Cat pose="rope" size={120} />
          <Cat pose="rope" size={420} />
        </div>
        <p style={caption}>Motion (tail sway, blink, wobble, float) stops when the system asks for reduced motion.</p>
      </section>
    </div>
  );
}
