// Places the VS Code recreation for the current format and scales it up.
import type { ReactNode } from "react";
import { useLayout } from "../layout";
import { Scaled } from "../ui";

export interface Frame {
  x: number;
  y: number;
  /** Size of the window in VS Code's CSS pixels. */
  w: number;
  h: number;
  scale: number;
}

export function useFrame(): Frame {
  const { vertical, margin, content, top, bottom, ui } = useLayout();
  const w = Math.round(content / ui);
  const h = Math.round((bottom - top) / ui);
  return { x: margin, y: top, w, h, scale: ui, ...(vertical ? {} : {}) };
}

/** Video coordinates of a point given in window CSS pixels. */
export const toVideo = (f: Frame, x: number, y: number) => ({ x: f.x + x * f.scale, y: f.y + y * f.scale });

export function Shell({ children, frame, opacity = 1, offset = 0, zoom = 1, origin = "50% 50%" }: { children: ReactNode; frame?: Frame; opacity?: number; offset?: number; zoom?: number; origin?: string }) {
  const f = frame ?? useFrame();
  return (
    <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${offset}px) scale(${zoom})`, transformOrigin: origin }}>
      <Scaled x={f.x} y={f.y} width={f.w} height={f.h} scale={f.scale}>
        {children}
      </Scaled>
    </div>
  );
}

/** Mixes two #rrggbb colours. */
export function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
