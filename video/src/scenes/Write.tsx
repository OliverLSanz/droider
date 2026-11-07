// One click on "Write to DROID": written, verified, ejected. Then the card goes
// into the module of the opening, and this time it plays.
import { Easing } from "remotion";
import { docs, patch, tokens } from "../data";
import { useLayout } from "../layout";
import { MODULE, Module } from "../Module";
import { RUNNING, SCENES, WRITE_CLICK, WRITTEN, euclid, lastNote, notes } from "../score";
import { theme } from "../theme";
import { lerp, ramp } from "../timing";
import { Caption, G, Path } from "../ui";
import { Code, Group, M, Toast, Window, vs } from "../vscode/Editor";
import * as I from "../vscode/Icons";
import { Shell, useFrame } from "./Shell";

const duet = tokens(docs.duet, "droider");
const PLUCK = docs.duet.split("\n").indexOf("[pluck]");
const COLORS = ["#38BDF8", "#60A5FA", "#818CF8", "#A78BFA", "#C084FC", "#E879F9", "#F472B6", "#FB7185"];

/** The 16 LEDs while the duet plays: the lead's Euclidean pattern, the playhead, and every hit. */
export function runningLeds(step: number, on: number) {
  const playhead = Math.floor(step) % 16;
  const lead = lastNote(step, "lead");
  const bass = lastNote(step, "bass");
  return Array.from({ length: 16 }, (_, i) => {
    let level = euclid(i, 9) ? 0.22 : 0;
    let color = COLORS[Math.floor(i / 2)];
    if (lead && lead.step % 16 === i) level = Math.max(level, Math.max(0, 1 - (step - lead.step) / 3));
    if (bass && bass.step % 16 === i && step - bass.step < 6) {
      level = Math.max(level, 1 - (step - bass.step) / 6);
      color = "#34D399";
    }
    if (i === playhead) {
      level = Math.max(level, 0.75);
      color = level > 0.9 ? color : "#E9EDF3";
    }
    return level * on > 0.01 ? { color, level: Math.min(1, level * on) } : null;
  });
}

export function Write({ step }: { step: number }) {
  const { vertical, width } = useLayout();
  const f = useFrame();
  const local = step - SCENES.write.from;
  const click = WRITE_CLICK - SCENES.write.from;
  const written = WRITTEN - SCENES.write.from;
  const running = RUNNING - SCENES.write.from;

  // Zoom into the status bar for the click, back out for the message.
  const zoomIn = ramp(local, 1, 5, Easing.inOut(Easing.cubic)) * (1 - ramp(local, 20, 23.5, Easing.inOut(Easing.cubic)));
  const away = ramp(local, 24, 28, Easing.inOut(Easing.cubic));
  const zoom = lerp(1, vertical ? 1.45 : 1.3, zoomIn) * lerp(1, vertical ? 0.9 : 0.64, away);
  const item = { x: f.w - 30 - 50, y: f.h - M.status / 2 };

  const stage = local < click ? 0 : local < click + 6 ? 1 : local < click + 10 ? 2 : local < written ? 3 : 4;
  const progress = [0, 0.3, 0.7, 1, 1][stage];
  const message = ["", "", ": Syncing...", ": Ejecting...", ""][stage];

  // Module: arrives as the window steps aside, the card goes in, Load, and it plays.
  const modIn = ramp(local, 24.5, 28, Easing.out(Easing.cubic));
  const modH = vertical ? 900 : 760;
  const modW = (MODULE.width * modH) / MODULE.height;
  const mod = vertical ? { x: width / 2 - modW / 2, y: 650 } : { x: 1300, y: 250 };
  const cardIn = ramp(local, 27, 29, Easing.in(Easing.quad));
  const on = ramp(local, running, running + 1);
  const hit = notes().find((n) => Math.abs(n.step - step) < 0.5 && n.voice === "bass") ? 1 : 0;

  return (
    <>
      <Shell
        opacity={vertical ? 1 - away : 1}
        zoom={zoom}
        origin={vertical ? `${f.x + item.x * f.scale}px ${f.y + item.y * f.scale}px` : away > 0 ? `120px 640px` : `${f.x + item.x * f.scale}px ${f.y + item.y * f.scale}px`}
      >
        <Window
          width={f.w}
          height={f.h}
          status={{
            position: `Ln ${PLUCK + 1}, Col 1`,
            language: "DROID Patch (with sugar)",
            card: local < written + 1 ? "write" : "build",
            cardGlow: local < click + 2 ? ramp(local, 3, 5) * (0.6 + 0.4 * Math.sin(local * 2)) : 0,
            cardPressed: Math.max(0, 1 - Math.abs(local - click) / 0.6),
          }}
        >
          <Group width="100%" tabs={[{ name: "pluck.blueprint" }, { name: "duet.droider", active: true }]} actions={["build", "graph", "hardware", "split", "more"]}>
            <Code lines={duet} scroll={6} caret={{ line: PLUCK, col: 0 }} />
          </Group>
          {stage >= 1 && stage <= 3 ? (
            <Toast progress={progress} width={360}>
              <span style={{ color: vs.fg }}>
                {patch.messages.writing}
                {message}
              </span>
            </Toast>
          ) : null}
          {stage === 4 ? (
            <Toast appear={ramp(local, written, written + 0.8)} width={vertical ? 470 : 430}>
              <I.Info size={16} />
              <span>{patch.messages.written}</span>
            </Toast>
          ) : null}
        </Window>
        <Path
          step={local}
          stops={[
            { at: 3, x: item.x - 120, y: item.y - 80 },
            { at: click, x: item.x, y: item.y - 2, click: true },
          ]}
          scale={0.8}
          fadeOut={3}
        />
      </Shell>
      {/* Keep the caption readable while the camera is in close. */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: vertical ? 560 : 300, background: `linear-gradient(${theme.bg} 70%, ${theme.bg}00)`, opacity: zoomIn }} />
      <Caption
        eyebrow="WRITE TO DROID"
        color={theme.green}
        step={local}
        lines={[
          { at: 0, text: "One click to write it to the card." },
          { at: written - 1, text: "Verified, and safely ejected." },
          { at: running, text: <>Load. <G>It just plays.</G></> },
        ]}
      />
      {modIn > 0 ? (
        <div style={{ position: "absolute", left: mod.x + (1 - modIn) * 300, top: mod.y, opacity: modIn }}>
          <div
            style={{
              position: "absolute",
              left: modW / 2 - 450,
              top: modH * 0.55 - 450,
              width: 900,
              height: 900,
              background: `radial-gradient(circle, ${hit ? "#34D39926" : "#A78BFA22"}, transparent 62%)`,
              opacity: on,
            }}
          />
          <Module
            height={modH}
            leds={runningLeds(step, on)}
            card={cardIn}
            slot={ramp(local, 28.5, 29) * (1 - ramp(local, 31, 34))}
            load={local >= running - 0.5 ? Math.max(0, 1 - (local - running + 0.5) / 2) : 0}
          />
        </div>
      ) : null}
    </>
  );
}
