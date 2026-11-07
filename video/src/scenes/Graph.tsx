// The Circuit Graph of melody.ini (the extension's own render), with its ports
// lighting up as the clock, the gates and the envelope run through it.
import { Easing, Img, staticFile } from "remotion";
import { useLayout } from "../layout";
import { SCENES, envelope, lastNote } from "../score";
import { theme } from "../theme";
import { lerp, ramp } from "../timing";
import { Caption } from "../ui";
import { Group, M, Window } from "../vscode/Editor";
import { Shell, useFrame } from "./Shell";

/** public/view-melody-graph.webp is 2800×1640: the webview at 2×. */
const IMG = { w: 1400, h: 820 };
/** Port positions in the webview's CSS pixels. */
const P = {
  lfoSquare: [364, 381],
  euklidClock: [452, 398],
  euklidOut: [624, 399],
  randomClock: [713, 304],
  contourTrigger: [721, 441],
  copyIn: [748, 601],
  contourOut: [902, 442],
  copyOut: [875, 601],
  miniOut: [1177, 275],
  o1: [1265, 417],
  o2: [1058, 583],
  o3: [1058, 517],
} as const;

export function Graph({ step }: { step: number }) {
  const { vertical } = useLayout();
  const f = useFrame();
  const local = step - SCENES.graph.from;
  const area = { w: f.w - M.activity - 2, h: f.h - M.status - M.tabs };

  // Fill the group, centred on the nodes, drifting slowly towards the outputs.
  const t = ramp(local, -2, 32, Easing.inOut(Easing.sin));
  const scale = vertical ? (area.h / IMG.h) * lerp(1.18, 1.3, t) : (area.w / IMG.w) * lerp(1.08, 1.2, t);
  const focus = { x: lerp(vertical ? 430 : 640, vertical ? 960 : 760, t), y: lerp(430, 440, t) };
  const left = area.w / 2 - focus.x * scale;
  const top = area.h / 2 - focus.y * scale;

  const note = lastNote(step, "lead");
  const since = note ? step - note.step : 99;
  const gate = since < 1 ? 1 - since : 0;
  const env = envelope(step, "lead");
  const clock = Math.max(0, 1 - (step % 1) * 3);
  const glows: { at: readonly [number, number]; level: number; color: string }[] = [
    { at: P.lfoSquare, level: clock * 0.7, color: "#4EC9B0" },
    { at: P.euklidClock, level: clock * 0.7, color: "#4EC9B0" },
    { at: P.euklidOut, level: gate, color: theme.green },
    { at: P.randomClock, level: gate, color: theme.green },
    { at: P.contourTrigger, level: gate, color: theme.green },
    { at: P.copyIn, level: gate, color: theme.green },
    { at: P.copyOut, level: gate, color: "#F28C6B" },
    { at: P.o2, level: gate, color: "#F28C6B" },
    { at: P.miniOut, level: env, color: "#F28C6B" },
    { at: P.o1, level: env, color: "#F28C6B" },
    { at: P.contourOut, level: env, color: "#F28C6B" },
    { at: P.o3, level: env, color: "#F28C6B" },
  ];
  const appear = ramp(local, -1, 1.5);

  return (
    <>
      <Caption
        eyebrow="CIRCUIT GRAPH"
        step={local}
        lines={[
          { at: 0, text: "Follow the signal, circuit by circuit." },
        ]}
      />
      <Shell>
        <Window width={f.w} height={f.h} status={{ position: "Ln 1, Col 1" }}>
          <Group width="100%" tabs={[{ name: "melody.ini" }, { name: "DROID Circuit Graph", active: true }]} actions={["split", "more"]}>
            <div style={{ position: "absolute", inset: 0, background: "#121212", opacity: appear }}>
              <div style={{ position: "absolute", left, top, width: IMG.w, height: IMG.h, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
                <Img src={staticFile("view-melody-graph.webp")} style={{ width: IMG.w, height: IMG.h }} />
                {glows.map((g, i) =>
                  g.level > 0.03 ? (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: g.at[0] - 12,
                        top: g.at[1] - 12,
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        background: g.color,
                        opacity: g.level * 0.55,
                        boxShadow: `0 0 ${18 * g.level}px ${8 * g.level}px ${g.color}`,
                        mixBlendMode: "screen",
                      }}
                    />
                  ) : null,
                )}
              </div>
            </div>
          </Group>
        </Window>
      </Shell>
    </>
  );
}
