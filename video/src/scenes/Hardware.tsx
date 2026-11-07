// The label legend at the top of melody.ini, then the Hardware View: the same
// labels on the rack (the extension's own render), lit by the patch as it plays.
import { Easing, Img, staticFile } from "remotion";
import { docs, tokens } from "../data";
import { useLayout } from "../layout";
import { SCENES, envelope, lastNote } from "../score";
import { theme } from "../theme";
import { lerp, ramp } from "../timing";
import { Caption, G } from "../ui";
import { Code, Group, M, Window, vs } from "../vscode/Editor";
import { Shell, useFrame } from "./Shell";

const doc = docs.melody;
const lines = doc.split("\n");
const highlighted = tokens(doc);

/** Positions of the labels in public/hw-crop.webp (620×1020, the Hardware View at 2×). */
const JACKS: Record<string, [number, number]> = {
  RESET: [73, 617],
  PITCH: [73, 769],
  GATE: [157, 769],
  ENV: [240, 769],
  RATE: [492, 193],
  DENS: [492, 348],
  OCT: [460, 489],
};
const IMG = { w: 620, h: 1020 };

const TAGS = lines
  .map((l, line) => {
    const m = l.match(/^#\s+\S+:\s+\[([A-Z]+)\]/);
    if (!m) return null;
    return { name: m[1], line, from: l.indexOf("["), to: l.indexOf("]") + 1 };
  })
  .filter((t): t is { name: string; line: number; from: number; to: number } => t !== null && t.name in JACKS);

export function Hardware({ step }: { step: number }) {
  const { vertical } = useLayout();
  const f = useFrame();
  const local = step - SCENES.hardware.from;
  const split = ramp(local, 11, 15, Easing.inOut(Easing.cubic));
  const area = { w: f.w - M.activity, h: f.h - M.status };

  // Group sizes: side by side in 16:9, stacked in 9:16.
  const firstSize = vertical ? lerp(area.h, 248, split) : lerp(area.w, 470, split);
  const second = vertical ? { x: 0, y: firstSize, w: area.w, h: area.h - firstSize } : { x: firstSize, y: 0, w: area.w - firstSize, h: area.h };
  const imgH = second.h - M.tabs - 24;
  const imgScale = imgH / IMG.h;
  const imgW = IMG.w * imgScale;
  const img = { x: second.x + (second.w - imgW) / 2, y: second.y + M.tabs + 12 };
  const ring = (name: string) => (name === "RATE" || name === "DENS" ? 62 : 40) * imgScale;
  const jack = (name: string) => ({ x: img.x + JACKS[name][0] * imgScale, y: img.y + JACKS[name][1] * imgScale });

  // The music on the jacks.
  const env = envelope(step, "lead");
  const note = lastNote(step, "lead");
  const gate = note && step - note.step < 0.9 ? 1 : 0;
  const oct = Math.floor(step / 16) % 4 === 3 && step % 16 >= 8 ? 1 : 0;
  const clock = Math.max(0, 1 - (step % 1) * 2.5);
  const live: Record<string, number> = { PITCH: env * 0.8, GATE: gate, ENV: env, OCT: oct, RATE: clock * 0.6, DENS: 0, RESET: 0 };

  return (
    <>
      <Caption
        eyebrow="LABELS · HARDWARE VIEW"
        step={local}
        color={theme.amber}
        lines={[
          { at: 0, text: "Label your jacks in a comment…" },
          { at: 15, text: <>…and see them <G>on your rack.</G></> },
        ]}
      />
      <Shell>
        <Window width={f.w} height={f.h} status={{ position: "Ln 1, Col 1" }}>
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: vertical ? "100%" : firstSize, height: vertical ? firstSize : "100%", display: "flex" }}>
              <Group width="100%" tabs={[{ name: "melody.ini", active: true }]} actions={split > 0.5 ? ["more"] : ["graph", "hardware", "split", "more"]}>
                <Code
                  lines={highlighted}
                  scroll={vertical ? 1.6 * split : 0}
                  caret={{ line: 0, col: 0 }}
                  caretVisible={false}
                  marks={TAGS.map((t, i) => ({
                    line: t.line,
                    from: t.from,
                    to: t.to,
                    color: theme.amber,
                    opacity: ramp(local, 2 + i * 1.1, 3 + i * 1.1) * 0.24,
                  }))}
                />
              </Group>
            </div>
            {split > 0 ? (
              <div style={{ position: "absolute", left: second.x, top: second.y, width: second.w, height: second.h, display: "flex", opacity: ramp(local, 11.5, 13.5) }}>
                <Group width="100%" tabs={[{ name: "DROID Hardware", active: true }]} actions={["split", "more"]}>
                  <div style={{ position: "absolute", inset: 0, background: vs.editor }} />
                </Group>
              </div>
            ) : null}
            {split > 0 ? (
              <>
                <Img src={staticFile("hw-crop.webp")} style={{ position: "absolute", left: img.x, top: img.y, width: imgW, height: imgH, borderRadius: 6, opacity: ramp(local, 12.5, 15) }} />
                {Object.keys(JACKS).map((name) => {
                  const p = jack(name);
                  const level = live[name] * ramp(local, 15, 16);
                  if (level < 0.02) return null;
                  const r = ring(name);
                  return (
                    <div
                      key={name}
                      style={{
                        position: "absolute",
                        left: p.x - r,
                        top: p.y - r,
                        width: 2 * r,
                        height: 2 * r,
                        borderRadius: "50%",
                        boxShadow: `0 0 ${16 * level}px ${3 * level}px ${name === "OCT" ? theme.amber : name === "GATE" ? theme.green : theme.cyan}`,
                        border: `2px solid ${name === "OCT" ? theme.amber : name === "GATE" ? theme.green : theme.cyan}`,
                        opacity: level,
                      }}
                    />
                  );
                })}
              </>
            ) : null}
            {/* Cables from each label to its jack. */}
            <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }} width={1} height={1}>
              <defs>
                <linearGradient id="hwcable" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#38BDF8" />
                  <stop offset="0.5" stopColor="#A78BFA" />
                  <stop offset="1" stopColor="#F472B6" />
                </linearGradient>
              </defs>
              {split > 0.99
                ? TAGS.map((t, i) => {
                    const scroll = vertical ? 1.6 : 0;
                    // From the end of the label's line to the edge of its jack, so no text is covered.
                    const a = { x: M.gutter + lines[t.line].length * M.char + 8, y: M.tabs + 4 + (t.line - scroll) * M.line + M.line / 2 };
                    const r = ring(t.name);
                    const j = jack(t.name);
                    const b = vertical ? { x: j.x, y: j.y - r } : { x: j.x - r, y: j.y };
                    const start = 15.5 + i * 1.6;
                    const draw = ramp(local, start, start + 2, Easing.inOut(Easing.cubic));
                    // The newest cable is bright; earlier ones settle back.
                    const fade = (1 - 0.65 * ramp(local, start + 2.5, start + 4)) * (1 - ramp(local, 36, 40));
                    const c1 = vertical ? { x: a.x + 60, y: a.y + 80 } : { x: a.x + 140, y: a.y };
                    const c2 = vertical ? { x: b.x, y: b.y - 120 } : { x: b.x - 120, y: b.y };
                    return (
                      <g key={t.name} opacity={fade * 0.9}>
                        <path
                          d={`M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`}
                          stroke="url(#hwcable)"
                          strokeWidth={2.6}
                          fill="none"
                          strokeLinecap="round"
                          pathLength={1}
                          strokeDasharray={1}
                          strokeDashoffset={1 - draw}
                          style={{ filter: "drop-shadow(0 0 4px #A78BFA)" }}
                        />
                      </g>
                    );
                  })
                : null}
            </svg>
          </div>
        </Window>
      </Shell>
    </>
  );
}
