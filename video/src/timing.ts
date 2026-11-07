import { Easing, interpolate, useCurrentFrame } from "remotion";
import { frameToStep } from "./score";

/** The current position in 1/16 steps from the start of the video. */
export function useStep() {
  return frameToStep(useCurrentFrame());
}

/** 0 → 1 between two step positions, eased. */
export function ramp(step: number, from: number, to: number, easing = Easing.out(Easing.cubic)) {
  return interpolate(step, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

/** A spring-like overshoot, 0 → 1 between two steps. */
export const pop = (step: number, from: number, to: number) => ramp(step, from, to, Easing.out(Easing.back(1.7)));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
