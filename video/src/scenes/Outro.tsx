// The last chord: name, what it costs, where to get it.
import { Easing } from "remotion";
import { useLayout } from "../layout";
import { Logo } from "../Logo";
import { SCENES } from "../score";
import { gradientText, theme } from "../theme";
import { ramp } from "../timing";
import { Glow } from "../ui";
import { melodyLeds } from "./Title";

export function Outro({ step }: { step: number }) {
  const { vertical } = useLayout();
  const { from, to } = SCENES.outro;
  const local = step - from;
  const flash = Math.max(0, 1 - local / 3);
  const icon = ramp(step, from, from + 3, Easing.out(Easing.back(1.7)));
  const name = ramp(step, from + 1, from + 4);
  const free = ramp(step, from + 4, from + 7);
  const search = ramp(step, from + 8, from + 11);
  const url = ramp(step, from + 10, from + 13, Easing.out(Easing.back(1.4)));
  const end = ramp(step, to - 4, to, Easing.in(Easing.cubic));
  const glow = local > 13 ? 0.5 + 0.5 * Math.cos(((local - 13) / 8) * 2 * Math.PI) : 0;

  return (
    <div style={{ position: "absolute", inset: 0, background: theme.bg, overflow: "hidden" }}>
      <Glow />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          opacity: 1 - end,
        }}
      >
        <div style={{ transform: `scale(${icon})`, filter: "drop-shadow(0 30px 60px #000c)" }}>
          <Logo size={vertical ? 260 : 210} extra={melodyLeds(step)} />
        </div>
        <div
          style={{
            font: `700 ${vertical ? 140 : 124}px/1 ${theme.sans}`,
            letterSpacing: "-0.05em",
            color: theme.text,
            marginTop: vertical ? 54 : 40,
            opacity: name,
            transform: `translateY(${(1 - name) * 26}px)`,
          }}
        >
          Droider
        </div>
        <div
          style={{
            font: `600 ${vertical ? 52 : 46}px ${theme.sans}`,
            letterSpacing: "-0.02em",
            marginTop: 22,
            opacity: free,
            transform: `translateY(${(1 - free) * 20}px)`,
            ...gradientText,
          }}
        >
          Free &amp; open source
        </div>
        <div
          style={{
            marginTop: vertical ? 90 : 60,
            font: `500 ${vertical ? 40 : 34}px ${theme.sans}`,
            color: theme.muted,
            opacity: search,
            transform: `translateY(${(1 - search) * 16}px)`,
            maxWidth: vertical ? 900 : undefined,
            lineHeight: 1.3,
          }}
        >
          Search <span style={{ color: theme.text }}>“Droider”</span> in VS Code Extensions
        </div>
        <div
          style={{
            marginTop: 28,
            padding: vertical ? "26px 44px" : "22px 40px",
            borderRadius: 999,
            background: theme.text,
            color: theme.bg,
            // Mono so the "l" in oliverlsanz can't be read as a capital I.
            font: `600 ${vertical ? 46 : 40}px ${theme.mono}`,
            letterSpacing: "-0.02em",
            opacity: url,
            transform: `scale(${0.85 + 0.15 * url})`,
            boxShadow: `0 0 0 3px #0B0D11, 0 0 0 5px rgba(167,139,250,${0.4 + 0.4 * glow}), 0 24px ${60 + 30 * glow}px -16px #A78BFA`,
          }}
        >
          oliverlsanz.com/droider
        </div>
      </div>
      <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash * 0.18 }} />
    </div>
  );
}
