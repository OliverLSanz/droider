// The title lands on the first downbeat; the icon's LEDs play the melody.
import { Easing } from "remotion";
import { useLayout } from "../layout";
import { Logo } from "../Logo";
import { SCENES, envelope, lastNote } from "../score";
import { gradientText, theme } from "../theme";
import { ramp } from "../timing";
import { Glow } from "../ui";

const LED_COLORS = ["#38BDF8", "#A78BFA", "#F472B6", "#34D399", "#FBBF24"];

/** The icon's extra LEDs, lit by the lead voice: one LED per note. */
export function melodyLeds(step: number) {
  const n = lastNote(step, "lead");
  if (!n) return {};
  const level = envelope(step, "lead");
  return { [(n.midi * 7) % 16]: { color: LED_COLORS[n.midi % 5], level } };
}

export function Title({ step }: { step: number }) {
  const { vertical } = useLayout();
  const { from, to } = SCENES.title;
  const local = step - from;
  const enter = ramp(step, from, from + 3, Easing.out(Easing.back(1.6)));
  const exit = ramp(step, to - 3, to, Easing.in(Easing.cubic));
  const flash = Math.max(0, 1 - local / 2.5);
  const name = ramp(step, from + 1, from + 4);
  const tagline = ramp(step, from + 5, from + 9);
  const free = ramp(step, from + 11, from + 15);

  return (
    <div style={{ position: "absolute", inset: 0, background: theme.bg, overflow: "hidden" }}>
      <Glow />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: vertical ? "column" : "row",
          gap: vertical ? 70 : 100,
          opacity: 1 - exit,
          transform: `translateY(${-exit * 60}px)`,
        }}
      >
        <div style={{ transform: `scale(${0.6 + 0.4 * enter})`, filter: "drop-shadow(0 40px 80px #000c)" }}>
          <Logo size={vertical ? 380 : 400} extra={melodyLeds(step)} cable={ramp(step, from, from + 4)} />
        </div>
        <div style={{ width: vertical ? 940 : 980, textAlign: vertical ? "center" : "left" }}>
          <div
            style={{
              font: `700 ${vertical ? 150 : 150}px/1 ${theme.sans}`,
              letterSpacing: "-0.05em",
              color: theme.text,
              opacity: name,
              transform: `translateX(${(1 - name) * -30}px)`,
            }}
          >
            Droider
          </div>
          <div
            style={{
              font: `600 ${vertical ? 68 : 64}px/1.1 ${theme.sans}`,
              letterSpacing: "-0.03em",
              marginTop: 34,
              opacity: tagline,
              transform: `translateY(${(1 - tagline) * 24}px)`,
              color: theme.text,
            }}
          >
            DROID patches
            <br />
            <span style={gradientText}>without the guesswork.</span>
          </div>
          <div
            style={{
              marginTop: 34,
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 26px",
              borderRadius: 999,
              border: `1px solid ${theme.line2}`,
              background: theme.surface,
              font: `500 ${vertical ? 36 : 32}px ${theme.sans}`,
              color: theme.muted,
              opacity: free,
              transform: `translateY(${(1 - free) * 20}px)`,
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 6, background: theme.green, boxShadow: `0 0 14px ${theme.green}` }} />
            A free extension for VS Code.
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash * 0.22 }} />
    </div>
  );
}
