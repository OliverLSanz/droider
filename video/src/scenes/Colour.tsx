// The same patch, now with the extension: semantic colours line by line, then
// each cable lights up wherever it goes.
import { docs, tokens } from "../data";
import { colors, plain, cableColor } from "../highlight";
import { useLayout } from "../layout";
import { SCENES } from "../score";
import { theme } from "../theme";
import { ramp } from "../timing";
import { Caption, G } from "../ui";
import { Code, Group, Window, type Mark } from "../vscode/Editor";
import { Shell, mix, useFrame } from "./Shell";

const doc = docs.melody;
const lines = doc.split("\n");
const coloured = tokens(doc);
const grey = plain(doc);
const SCROLL = lines.indexOf("[p2b8]");
const CABLES = ["_CLOCK", "_GATE", "_RANDOM"];

export const LEGEND = [
  { label: "input", color: colors.input },
  { label: "output", color: colors.output },
  { label: "register", color: colors.register },
  { label: "on / off", color: colors.bool },
];

export function Colour({ step }: { step: number }) {
  const { vertical, margin } = useLayout();
  const f = useFrame();
  const { from } = SCENES.colour;
  const local = step - from;

  // The colour sweeps down the file.
  const shown = coloured.map((toks, i) => {
    const t = ramp(local, 3 + (i - SCROLL) * 0.32, 4.5 + (i - SCROLL) * 0.32);
    if (t <= 0) return grey[i];
    return toks.map((tok) => ({ text: tok.text, color: mix(colors.fg, tok.color, t) }));
  });

  // Then each cable in turn glows wherever it is used.
  const marks: Mark[] = [];
  CABLES.forEach((cable, k) => {
    const start = 20 + k * 5;
    const glow = ramp(local, start, start + 1) * (1 - ramp(local, start + 5, start + 6.5));
    if (glow <= 0) return;
    lines.forEach((l, line) => {
      const code = l.split("#")[0];
      let at = code.indexOf(cable);
      while (at >= 0) {
        if (!/[A-Za-z0-9_]/.test(code[at + cable.length] ?? "")) marks.push({ line, from: at, to: at + cable.length, color: cableColor(cable), opacity: glow * 0.28 });
        at = code.indexOf(cable, at + 1);
      }
    });
  });

  const legendIn = (i: number) => ramp(local, 9 + i * 1.2, 11 + i * 1.2);
  const legend = (
    <>
      {LEGEND.map((l, i) => (
        <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 12, opacity: legendIn(i), transform: `translateX(${(1 - legendIn(i)) * 20}px)` }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: l.color, boxShadow: `0 0 12px ${l.color}88` }} />
          <span style={{ color: l.color }}>{l.label}</span>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: legendIn(4), transform: `translateX(${(1 - legendIn(4)) * 20}px)` }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, background: `linear-gradient(135deg, ${CABLES.map(cableColor).join(", ")})` }} />
        <span>
          {"cables".split("").map((ch, i) => (
            <span key={i} style={{ color: cableColor(CABLES[i % 3]) }}>
              {ch}
            </span>
          ))}
        </span>
      </div>
    </>
  );

  return (
    <>
      <Caption
        eyebrow="SEMANTIC COLOURS"
        step={local}
        lines={[
          { at: 0, text: "See your patch at a glance." },
          { at: 19, text: <>Every cable gets <G>its own colour.</G></> },
        ]}
      />
      <Shell>
        <Window width={f.w} height={f.h} status={{ position: "Ln 1, Col 1", card: "card" }}>
          <Group width="100%" tabs={[{ name: "melody.ini", active: true }]} actions={["graph", "hardware", "split", "more"]}>
            <Code lines={shown} scroll={SCROLL} caret={null} marks={marks} />
            {!vertical ? (
              <div
                style={{
                  position: "absolute",
                  right: 26,
                  top: 26,
                  width: 200,
                  padding: "16px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  borderRadius: 12,
                  background: "#12151Bee",
                  border: `1px solid ${theme.line2}`,
                  font: `600 16px ${theme.mono}`,
                  boxShadow: "0 20px 40px -10px #000",
                  opacity: legendIn(0),
                }}
              >
                {legend}
              </div>
            ) : null}
          </Group>
        </Window>
      </Shell>
      {vertical ? (
        <div style={{ position: "absolute", left: margin, right: margin, top: 452, display: "flex", flexWrap: "wrap", gap: "10px 30px", font: `600 30px ${theme.mono}` }}>{legend}</div>
      ) : null}
    </>
  );
}
