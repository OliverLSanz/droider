// Pieces shared by the scenes: the caption block, the mouse pointer, the scene
// transition and the scaled frame for the VS Code recreation.
import type { CSSProperties, ReactNode } from "react";
import { Easing } from "remotion";
import { useLayout } from "./layout";
import { gradientText, theme } from "./theme";
import { ramp } from "./timing";

export interface Line {
  at: number;
  text: ReactNode;
}

/** Eyebrow plus a headline that changes at each line's step. */
export function Caption({ eyebrow, lines, step, color = theme.cyan, until = 1e6 }: { eyebrow: string; lines: Line[]; step: number; color?: string; until?: number }) {
  const { vertical, margin, captionTop } = useLayout();
  const eyebrowIn = ramp(step, lines[0].at - 1, lines[0].at + 1);
  return (
    <div style={{ position: "absolute", left: margin, top: captionTop, right: margin, height: vertical ? 320 : 170 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          font: `600 ${vertical ? 24 : 19}px ${theme.mono}`,
          letterSpacing: "0.16em",
          color,
          opacity: eyebrowIn,
        }}
      >
        <span style={{ width: vertical ? 34 : 28, height: 3, borderRadius: 2, background: theme.gradient }} />
        {eyebrow}
      </div>
      {lines.map((line, i) => {
        const next = Math.min(lines[i + 1]?.at ?? 1e6, until);
        const t = ramp(step, line.at - 0.6, line.at + 1.4);
        const out = ramp(step, next - 1.8, next - 0.4, Easing.in(Easing.cubic));
        if (t <= 0 || out >= 1) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: vertical ? 50 : 40,
              left: 0,
              right: 0,
              font: `600 ${vertical ? 78 : 70}px/1.08 ${theme.sans}`,
              letterSpacing: "-0.035em",
              color: theme.text,
              opacity: t * (1 - out),
              transform: `translateY(${(1 - t) * 26 - out * 20}px)`,
              filter: t < 1 ? `blur(${(1 - t) * 6}px)` : undefined,
            }}
          >
            {line.text}
          </div>
        );
      })}
    </div>
  );
}

/** A word in the gradient. */
export const G = ({ children }: { children: ReactNode }) => <span style={gradientText}>{children}</span>;

export function Pointer({ x, y, press = 0, opacity = 1, scale = 1 }: { x: number; y: number; press?: number; opacity?: number; scale?: number }) {
  if (opacity <= 0) return null;
  return (
    <svg
      width={22 * scale}
      height={28 * scale}
      viewBox="0 0 22 28"
      style={{
        position: "absolute",
        left: x - 3 * scale,
        top: y - 2 * scale,
        transform: `scale(${1 - press * 0.15})`,
        transformOrigin: `${3 * scale}px ${2 * scale}px`,
        opacity,
        filter: "drop-shadow(0 3px 5px #000a)",
        zIndex: 20,
        overflow: "visible",
      }}
    >
      {press > 0 ? <circle cx="3" cy="2" r={6 + press * 8} fill="none" stroke="#38BDF8" strokeWidth={1.5} opacity={press} /> : null}
      <path d="M3 2 L3 22 L8.2 17.4 L11.6 25.2 L15 23.7 L11.7 16.1 L18.6 16 Z" fill="#fff" stroke="#111316" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export interface Stop {
  at: number;
  x: number;
  y: number;
  click?: boolean;
}

/** Pointer that travels between stops, arriving at each stop's step. */
export function Path({ stops, step, scale = 1, travel = 2.5, fadeOut = 3 }: { stops: Stop[]; step: number; scale?: number; travel?: number; fadeOut?: number }) {
  const k = stops.findLastIndex((s) => s.at <= step);
  let { x, y } = stops[Math.max(0, k)];
  if (k >= 0 && k < stops.length - 1) {
    const a = stops[k];
    const b = stops[k + 1];
    const move = Math.min(travel, b.at - a.at);
    const t = Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, (step - (b.at - move)) / move)));
    x = a.x + (b.x - a.x) * t;
    y = a.y + (b.y - a.y) * t;
  }
  const press = Math.max(0, ...stops.filter((s) => s.click).map((s) => (step >= s.at ? 1 - (step - s.at) / 1.2 : 1 - (s.at - step) / 0.3)));
  const first = stops[0].at;
  const last = stops[stops.length - 1].at;
  const opacity = ramp(step, first - 1.5, first) * (1 - ramp(step, last + fadeOut, last + fadeOut + 2));
  return <Pointer x={x} y={y} press={Math.min(1, press)} opacity={opacity} scale={scale} />;
}

/**
 * A scene fades in over the one before it (which stays opaque and only recedes),
 * so a transition never shows two half-transparent layouts.
 */
export function sceneStyle(step: number, from: number, to: number): CSSProperties {
  const enter = ramp(step, from - 2, from, Easing.out(Easing.cubic));
  const exit = ramp(step, to - 2, to, Easing.in(Easing.cubic));
  return {
    position: "absolute",
    inset: 0,
    background: theme.bg,
    overflow: "hidden",
    opacity: enter,
    transform: `translateY(${(1 - enter) * 40}px) scale(${1 - exit * 0.03})`,
    filter: exit > 0 ? `blur(${exit * 6}px)` : undefined,
  };
}

/** Soft coloured light behind the content. */
export function Glow({ strength = 1 }: { strength?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: strength,
        background:
          "radial-gradient(circle at 14% 12%, #38BDF81c, transparent 38%), radial-gradient(circle at 88% 85%, #F472B614, transparent 40%), radial-gradient(circle at 70% 8%, #A78BFA12, transparent 35%)",
      }}
    />
  );
}

/** Content laid out at `width`×`height` CSS pixels, scaled by `scale` and placed at `x`,`y`. */
export function Scaled({ x, y, width, height, scale, children, style }: { x: number; y: number; width: number; height: number; scale: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        transform: `scale(${scale})`,
        transformOrigin: "0 0",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A small rounded label that pops in, used to name what is on screen. */
export function Chip({ children, color = theme.cyan, appear = 1, style }: { children: ReactNode; color?: string; appear?: number; style?: CSSProperties }) {
  const { vertical } = useLayout();
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: vertical ? "10px 20px" : "8px 16px",
        borderRadius: 999,
        background: `${color}1f`,
        border: `1px solid ${color}66`,
        color,
        font: `600 ${vertical ? 28 : 22}px ${theme.mono}`,
        opacity: appear,
        transform: `scale(${0.85 + 0.15 * appear})`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
