// Opening: the patch in a plain text editor, a typo nobody flags, the card goes
// in, Load, and the module blinks an error. Then the loop again, faster.
import { Easing, interpolate } from "remotion";
import { docs } from "../data";
import { useLayout } from "../layout";
import { MODULE, Module, SLOT } from "../Module";
import { HOOK, SCENES } from "../score";
import { HOOK_LINE, hookTyped } from "../stories";
import { theme } from "../theme";
import { ramp } from "../timing";

const lines = docs.melody.split("\n");
const FIRST = lines.indexOf("# --- Envelope ----------------------------------------------");
const TYPO = lines.findIndex((l, i) => i > FIRST && l.startsWith("    output"));
const SHOWN = lines.slice(FIRST, lines.indexOf("[copy]") + 3);

const WORDS = [
  { at: HOOK.typeFrom, text: "Edit." },
  { at: HOOK.cardOut - 1, text: "Copy to the card." },
  { at: HOOK.load - 1, text: "Load." },
  { at: HOOK.blinkFrom, text: "Blink." },
  { at: HOOK.repeat, text: "Repeat." },
];

/** In "Repeat." the story replays, faster and faster: the virtual step it shows. */
function replay(step: number) {
  if (step < HOOK.repeat) return step;
  const t = step - HOOK.repeat;
  // Speed grows from 3× to ~9×; integrate it for the position in the loop.
  const travelled = 3 * t + 0.28 * t * t;
  const loop = HOOK.blinkTo + 2 - HOOK.typeFrom;
  return HOOK.typeFrom + (travelled % loop);
}

export function Hook({ step }: { step: number }) {
  const { vertical, width, margin } = useLayout();
  const v = replay(step);
  const repeating = step >= HOOK.repeat;
  const collapse = ramp(step, SCENES.hook.to - 5, SCENES.hook.to, Easing.in(Easing.cubic));
  const intro = ramp(step, 0, 3);

  // Layout.
  const ed = vertical
    ? { x: margin, y: 560, w: width - 2 * margin, h: 560 }
    : { x: 150, y: 190, w: 1000, h: 620 };
  const modH = vertical ? 540 : 680;
  const modW = (MODULE.width * modH) / MODULE.height;
  const mod = vertical ? { x: width / 2 - modW / 2, y: 1150 } : { x: 1430, y: 170 };
  const fontSize = vertical ? 25 : 27;
  const lineH = fontSize * 1.55;

  // The card's flight from the editor to the slot.
  const slotX = mod.x + (SLOT.x * modH) / MODULE.height;
  const slotY = mod.y + (SLOT.y * modH) / MODULE.height;
  const startX = ed.x + ed.w - 120;
  const startY = ed.y + 30;
  const fly = ramp(v, HOOK.cardOut, HOOK.cardIn - 2, Easing.inOut(Easing.cubic));
  const sink = ramp(v, HOOK.cardIn - 2, HOOK.cardIn, Easing.in(Easing.quad));
  const cardVisible = v >= HOOK.cardOut - 1 && v < HOOK.cardIn;
  const cx = interpolate(fly, [0, 1], [startX, slotX]);
  const cy = interpolate(fly, [0, 1], [startY, slotY - 60]) - Math.sin(fly * Math.PI) * (vertical ? 120 : 160) + sink * 46;
  const cardPop = ramp(v, HOOK.cardOut - 1, HOOK.cardOut + 1, Easing.out(Easing.back(2)));

  // LEDs: dark until Load, then the error blinks.
  const blinking = v >= HOOK.blinkFrom && v < HOOK.blinkTo + 2;
  const phase = Math.floor((v - HOOK.blinkFrom) / 2);
  const on = blinking && (v - HOOK.blinkFrom) % 2 < 1.1;
  const errorLeds = Array.from({ length: 16 }, (_, i) => {
    const r = Math.floor(i / 4);
    const c = i % 4;
    const cross = r === c || r + c === 3;
    if (!on) return null;
    return { color: phase % 2 === 0 ? (cross ? "#F43F5E" : "#7F1D2D") : cross ? "#7F1D2D" : "#F43F5E", level: cross === (phase % 2 === 0) ? 1 : 0.55 };
  });

  const typed = v < HOOK.typeFrom ? HOOK_LINE.slice(0, 4) : v >= HOOK.typeTo ? HOOK_LINE : hookTyped(v);
  const caretOn = Math.floor(v / 2.5) % 2 === 0 || (v > HOOK.typeFrom - 0.5 && v < HOOK.typeTo + 1);

  // Words: the current one bright.
  const current = repeating ? Math.floor((v - HOOK.typeFrom) / 9) % 4 : WORDS.findLastIndex((w) => w.at <= step);

  return (
    <div style={{ position: "absolute", inset: 0, background: theme.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: intro * (1 - collapse),
          transform: `scale(${1 - collapse * 0.5})`,
          filter: repeating ? `blur(${Math.min(4, (step - HOOK.repeat) * 0.3) + collapse * 10}px)` : undefined,
        }}
      >
        {/* A plain text editor: no colours, no help. */}
        <div
          style={{
            position: "absolute",
            left: ed.x,
            top: ed.y,
            width: ed.w,
            height: ed.h,
            borderRadius: 14,
            background: "#16181C",
            border: `1px solid ${theme.line2}`,
            boxShadow: "0 40px 100px -30px #000",
            overflow: "hidden",
          }}
        >
          <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", background: "#1E2126", borderBottom: `1px solid ${theme.line}` }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <span key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c, opacity: 0.55 }} />
            ))}
            <span style={{ flex: 1, textAlign: "center", font: `500 20px ${theme.sans}`, color: theme.muted, marginRight: 60 }}>droid.ini</span>
          </div>
          <div style={{ padding: "22px 30px", font: `400 ${fontSize}px/${lineH}px ${theme.mono}`, color: "#A9AFB8", whiteSpace: "pre" }}>
            {SHOWN.map((l, i) => {
              const isTypo = FIRST + i === TYPO;
              return (
                <div key={i} style={{ height: lineH, position: "relative" }}>
                  {isTypo ? typed : l}
                  {isTypo && caretOn ? <span style={{ display: "inline-block", width: 3, height: fontSize * 1.15, background: "#E9EDF3", verticalAlign: "middle", marginLeft: 1 }} /> : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* The SD card in flight. */}
        {cardVisible ? (
          <div
            style={{
              position: "absolute",
              left: cx - 34,
              top: cy - 44,
              width: 68,
              height: 88,
              transform: `rotate(${(1 - fly) * -14}deg) scale(${cardPop * (1 - sink * 0.3)})`,
              clipPath: "polygon(0 0, 72% 0, 100% 20%, 100% 100%, 0 100%)",
              borderRadius: 8,
              background: "linear-gradient(180deg, #E9EDF3, #C9D0DA)",
              boxShadow: "0 12px 30px #000a",
            }}
          >
            <div style={{ position: "absolute", left: 8, right: 8, bottom: 10, height: 26, borderRadius: 4, background: theme.gradient }} />
            <div style={{ position: "absolute", left: 8, top: 10, font: `700 11px ${theme.mono}`, color: "#0B0D11" }}>SD</div>
          </div>
        ) : null}

        <div style={{ position: "absolute", left: mod.x, top: mod.y }}>
          <Module
            height={modH}
            leds={errorLeds}
            slot={ramp(v, HOOK.cardIn - 1, HOOK.cardIn) * (1 - ramp(v, HOOK.cardIn + 2, HOOK.cardIn + 6))}
            card={v >= HOOK.cardIn - 0.01 ? 1 : 0}
            load={v >= HOOK.load ? Math.max(0, 1 - (v - HOOK.load) / 2) : 0}
            shake={on ? Math.sin(v * 9) * 0.6 : 0}
          />
        </div>
        {/* Red light thrown by the blinking LEDs. */}
        <div
          style={{
            position: "absolute",
            left: mod.x + modW / 2 - 500,
            top: mod.y + modH * 0.55 - 500,
            width: 1000,
            height: 1000,
            background: "radial-gradient(circle, #F43F5E33, transparent 60%)",
            opacity: on ? 1 : 0,
          }}
        />
      </div>

      {/* The loop, word by word. */}
      <div
        style={{
          position: "absolute",
          left: margin,
          right: margin,
          top: vertical ? 210 : 890,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: vertical ? "flex-start" : "center",
          columnGap: vertical ? 24 : 30,
          rowGap: 4,
          font: `600 ${vertical ? 84 : 74}px/1.15 ${theme.sans}`,
          letterSpacing: "-0.035em",
          opacity: 1 - collapse,
        }}
      >
        {WORDS.map((w, i) => {
          const t = ramp(step, w.at - 0.5, w.at + 1.5);
          const active = i === current || (i === 4 && repeating);
          const color = i === 3 && active && !repeating ? "#FB7185" : active ? theme.text : "#5B6472";
          return (
            <span
              key={w.text}
              style={{
                opacity: t,
                transform: `translateY(${(1 - t) * 24}px)`,
                color,
                ...(i === 4 && repeating ? { background: "linear-gradient(100deg,#FB7185,#FBBF24)", WebkitBackgroundClip: "text", color: "transparent" } : {}),
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
      <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: Math.max(0, (step - (SCENES.hook.to - 1.5)) / 1.5) * 0.15 }} />
    </div>
  );
}
