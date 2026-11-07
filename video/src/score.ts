// The score of the video. The soundtrack (scripts/render-audio.ts) and the scenes
// both read it, so cuts, LEDs and notes land together.
//
// The music is what examples/melody.ini patches: a square LFO clock, a 16-step
// Euclidean rhythm, a random voltage on every beat snapped by [minifonion] to the
// chord tones of C natural minor, and a short [contour] pluck. In the .droider
// scene the second voice of examples/duet.droider joins as a bass.

export const FPS = 60;
export const BPM = 112;
export const SAMPLE_RATE = 44100;
/** One clock tick of the patch: a 1/16 step, 7.47 Hz (hz = P1.1 * 8 + 1 with P1.1 at 0.81). */
export const STEP_SECONDS = 60 / BPM / 4;

/** Scene boundaries, in steps from the start (16 steps = one bar). */
export const SCENES = {
  hook: { from: 0, to: 64 },
  title: { from: 64, to: 96 },
  colour: { from: 96, to: 136 },
  complete: { from: 136, to: 200 },
  hover: { from: 200, to: 232 },
  errors: { from: 232, to: 280 },
  hardware: { from: 280, to: 328 },
  graph: { from: 328, to: 360 },
  droider: { from: 360, to: 448 },
  write: { from: 448, to: 496 },
  outro: { from: 496, to: 552 },
} as const;
export type SceneName = keyof typeof SCENES;
export const END_STEP = SCENES.outro.to;

export const stepToSeconds = (step: number) => step * STEP_SECONDS;
export const stepToFrame = (step: number) => step * STEP_SECONDS * FPS;
export const frameToStep = (frame: number) => frame / FPS / STEP_SECONDS;
export const DURATION_IN_FRAMES = Math.ceil(stepToFrame(END_STEP));

// ── Story beats shared by picture and sound ──

/** The hook: the typo is typed, the card goes in, Load, the LEDs blink an error. */
export const HOOK = {
  typeFrom: 4,
  typeTo: 12,
  cardOut: 17,
  cardIn: 25,
  load: 29,
  blinkFrom: 33,
  blinkTo: 47,
  repeat: 49,
};
/** The error scene: O9 is typed at ERROR_ON and fixed at ERROR_OFF. */
export const ERROR_ON = SCENES.errors.from + 9;
export const ERROR_OFF = SCENES.errors.from + 31;
/** The kick joins when the patch is clean again, on the next downbeat. */
export const KICK_IN = SCENES.hardware.from;
export const BASS_IN = SCENES.droider.from;
export const BUILD_CLICK = SCENES.droider.from + 62;
export const WRITE_CLICK = SCENES.write.from + 8;
export const WRITTEN = SCENES.write.from + 22;
/** The module loads the written patch and plays it. */
export const RUNNING = SCENES.write.from + 30;

// ── The patch, played ──

/** Deterministic pseudo-random numbers, so every render is identical. */
export function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** [euklid] length = 16: is `step` one of the `beats`, spread as evenly as possible? */
export const euclid = (step: number, beats: number, length = 16) => ((step % length) * beats) % length < beats;

/** P1.2 (DENS) over the video: beats = P1.2 * 12 + 2 in melody.ini, P1.2 * 10 + 3 in duet.droider. */
export function leadBeats(step: number) {
  if (step < SCENES.complete.from) return 5;
  if (step < SCENES.hardware.from) return 7;
  return 9;
}

/** [minifonion] root = 0, degree = 7 (natural minor): the selected scale degrees, as semitones. */
const C_MINOR = [0, 2, 3, 5, 7, 8, 10];
export const chordTones = (selects: number[]) => selects.map((s) => C_MINOR[s - 1]);

/** Snap a voltage to the nearest semitone, then up to the next selected note. */
export function quantize(volts: number, tones: number[]) {
  let semitone = Math.round(volts * 12);
  while (!tones.includes(((semitone % 12) + 12) % 12)) semitone++;
  return semitone;
}

export interface Note {
  step: number;
  voice: "lead" | "bass";
  /** MIDI note. */
  midi: number;
  /** [contour] decay in seconds. */
  decay: number;
  /** 0–1. */
  velocity: number;
}

/** Steps where the music plays at all. */
export const MUSIC_FROM = SCENES.title.from;
export const MUSIC_TO = SCENES.outro.to - 8;

/** OCT (B1.1) is held for the second half of every fourth bar: one octave up. */
const octave = (step: number) => (Math.floor(step / 16) % 4 === 3 && step % 16 >= 8 ? 1 : 0);

let memo: Note[] | null = null;
export function notes(): Note[] {
  if (memo) return memo;
  const lead = random(2024);
  const bass = random(7);
  const out: Note[] = [];
  for (let step = MUSIC_FROM; step < MUSIC_TO; step++) {
    const duet = step >= BASS_IN;
    if (euclid(step, leadBeats(step))) {
      // melody.ini: input = B1.1 * 1V + _RANDOM, select1/3/5/7. The pluck blueprint drops select7.
      const volts = octave(step) + lead() * 2;
      const tones = chordTones(duet ? [1, 3, 5] : [1, 3, 5, 7]);
      out.push({ step, voice: "lead", midi: 48 + quantize(volts, tones), decay: 0.25, velocity: step % 4 === 0 ? 1 : 0.82 });
    }
    // duet.droider, pluck #2: beats = 3, decay = 0.8, an octave below the lead.
    if (duet && euclid(step, 3)) {
      out.push({ step, voice: "bass", midi: 36 + quantize(bass() * 2, chordTones([1, 3, 5])), decay: 0.8, velocity: 1 });
    }
  }
  memo = out;
  return out;
}

/** [contour] attack = 0.01, sustain = 0: the envelope of a voice at a step (0–1). */
export function envelope(step: number, voice: Note["voice"]) {
  const list = notes();
  let last: Note | undefined;
  for (const n of list) {
    if (n.step > step) break;
    if (n.voice === voice) last = n;
  }
  if (!last) return 0;
  const t = stepToSeconds(step - last.step);
  if (t < 0.01) return (t / 0.01) * last.velocity;
  return Math.exp(-(t - 0.01) / (last.decay / 3)) * last.velocity;
}

/** The last note of a voice at or before a step. */
export function lastNote(step: number, voice: Note["voice"]) {
  let last: Note | undefined;
  for (const n of notes()) {
    if (n.step > step) break;
    if (n.voice === voice) last = n;
  }
  return last;
}
