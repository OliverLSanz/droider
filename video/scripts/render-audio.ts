// Synthesises the soundtrack from src/score.ts, with no samples:
//   - the hook: keys typing, the card going in, Load and the error blinks,
//   - then the patch itself (clock ticks, Euclidean plucks snapped to C minor),
//     building up scene by scene until the duet's bass voice joins.
// Writes public/soundtrack.wav (stereo PCM16 44.1 kHz), normalised to -14 LUFS.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASS_IN,
  BUILD_CLICK,
  DURATION_IN_FRAMES,
  ERROR_OFF,
  ERROR_ON,
  FPS,
  HOOK,
  KICK_IN,
  MUSIC_TO,
  RUNNING,
  SAMPLE_RATE,
  SCENES,
  STEP_SECONDS,
  WRITE_CLICK,
  WRITTEN,
  notes,
  random,
  stepToSeconds,
} from "../src/score.ts";
import { hookKeystrokes } from "../src/stories.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SR = SAMPLE_RATE;
const length = Math.ceil((DURATION_IN_FRAMES / FPS) * SR) + SR; // one extra second, trimmed by the video
const at = (step: number) => Math.round(stepToSeconds(step) * SR);
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Two stereo buses: the music (ducked while the patch has an error) and the effects. */
const music = [new Float32Array(length), new Float32Array(length)];
const fx = [new Float32Array(length), new Float32Array(length)];
const send = [new Float32Array(length), new Float32Array(length)]; // into the delay

function add(bus: Float32Array[], start: number, signal: Float32Array, gain: number, pan = 0) {
  const l = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const r = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < signal.length && start + i < length; i++) {
    if (start + i < 0) continue;
    bus[0][start + i] += signal[i] * l;
    bus[1][start + i] += signal[i] * r;
  }
}

/** A resonant state-variable low-pass, cutoff per sample. */
function lowpass(input: Float32Array, cutoff: (i: number) => number, q = 0.7) {
  const out = new Float32Array(input.length);
  let low = 0;
  let band = 0;
  for (let i = 0; i < input.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff(i), SR / 6)) / SR);
    for (let k = 0; k < 2; k++) {
      // Two passes per sample for stability at high cutoffs.
      const high = input[i] - low - band / q;
      band += (f / 2) * high;
      low += (f / 2) * band;
    }
    out[i] = low;
  }
  return out;
}

const noise = random(99);
const white = (n: number) => Float32Array.from({ length: n }, () => noise() * 2 - 1);

/** The pluck: detuned saw and square through a filter that closes with the envelope. */
function pluck(midi: number, decay: number, bright: number, seconds: number) {
  const n = Math.round(seconds * SR);
  const f = mtof(midi);
  const osc = new Float32Array(n);
  const env = new Float32Array(n);
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    env[i] = t < 0.01 ? t / 0.01 : Math.exp(-(t - 0.01) / (decay / 3.2));
    p1 = (p1 + f / SR) % 1;
    p2 = (p2 + (f * 1.004) / SR) % 1;
    p3 = (p3 + (f * 0.5) / SR) % 1;
    const saw = 2 * p1 - 1 + (2 * p2 - 1);
    const square = p3 < 0.5 ? 0.6 : -0.6;
    osc[i] = (saw * 0.5 + square * 0.35) * env[i];
  }
  const filtered = lowpass(osc, (i) => f * 1.2 + bright * env[i] ** 1.6, 1.1);
  // Release click guard.
  for (let i = Math.max(0, n - 400); i < n; i++) filtered[i] *= (n - i) / 400;
  return filtered;
}

function sine(freq: (t: number) => number, env: (t: number) => number, seconds: number) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * freq(t)) / SR;
    out[i] = Math.sin(phase) * env(t);
  }
  return out;
}

function kick(gain = 1) {
  return sine(
    (t) => 46 + 110 * Math.exp(-t / 0.035),
    (t) => gain * (t < 0.002 ? t / 0.002 : Math.exp(-t / 0.16)),
    0.5,
  );
}

/** The clock tick: a short burst of high-passed noise. */
function tick(decay = 0.018) {
  const n = Math.round(0.08 * SR);
  const w = white(n);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    out[i] = (w[i] - prev) * Math.exp(-i / SR / decay);
    prev = w[i];
  }
  return out;
}

/** A soft chord pad (C minor 9), fading in and out over `seconds`. */
function pad(midis: number[], seconds: number, attack: number, release: number) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  midis.forEach((m, k) => {
    const f = mtof(m);
    let a = (k * 0.37) % 1;
    let b = (k * 0.61) % 1;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      a = (a + f / SR) % 1;
      b = (b + (f * 1.003) / SR) % 1;
      const env = Math.min(1, t / attack) * Math.min(1, (seconds - t) / release);
      out[i] += (Math.sin(2 * Math.PI * a) + 0.35 * Math.sin(4 * Math.PI * b) + 0.5 * (2 * Math.abs(2 * b - 1) - 1)) * env * 0.22;
    }
  });
  return lowpass(out, () => 1400, 0.6);
}

function whoosh(seconds: number, from: number, to: number) {
  const n = Math.round(seconds * SR);
  const w = white(n);
  const shaped = lowpass(w, (i) => from * (to / from) ** (i / n), 2.2);
  for (let i = 0; i < n; i++) shaped[i] *= Math.sin((Math.PI * i) / n) ** 2;
  return shaped;
}

function beep(freq: number, seconds: number) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const square = Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1;
    out[i] = square * Math.min(1, t / 0.003) * Math.min(1, (seconds - t) / 0.01);
  }
  return lowpass(out, () => 2600, 0.7);
}

function click(bright = 4000) {
  const n = Math.round(0.03 * SR);
  const w = white(n);
  for (let i = 0; i < n; i++) w[i] *= Math.exp(-i / SR / 0.004);
  return lowpass(w, () => bright, 0.9);
}

// ── The hook: no music yet ──

for (const k of hookKeystrokes()) add(fx, at(k.at), click(k.space ? 2200 : 3600), k.space ? 0.4 : 0.55, 0.15);
add(fx, at(HOOK.cardOut - 1), whoosh(0.9, 400, 3000), 0.32, 0.3);
add(fx, at(HOOK.cardIn), click(1800), 0.9, 0.3);
add(fx, at(HOOK.cardIn) + 900, click(1200), 0.6, 0.3);
add(fx, at(HOOK.load), click(2600), 0.8, 0.3);
for (let s = HOOK.blinkFrom; s < HOOK.blinkTo; s += 2) add(fx, at(s), beep(s % 4 === HOOK.blinkFrom % 4 ? 330 : 247, 0.11), 0.16, 0.25);
// "Repeat.": the loop again, faster and faster, into a rising sweep.
{
  let s = HOOK.repeat;
  let gap = 2;
  while (s < SCENES.title.from - 1.5) {
    add(fx, at(s), beep(330, 0.06), 0.08, 0.25 - (s - HOOK.repeat) / 40);
    add(fx, at(s + gap / 2), click(3000), 0.18, -0.2);
    s += gap;
    gap = Math.max(0.5, gap * 0.82);
  }
}
const riseFrom = SCENES.title.from - 10;
add(fx, at(riseFrom), whoosh(stepToSeconds(10), 300, 9000), 0.42);

// ── Impacts ──

function impact(step: number, gain: number) {
  add(music, at(step), kick(1.15), gain);
  add(fx, at(step), whoosh(1.6, 5000, 200), gain * 0.35);
}
impact(SCENES.title.from, 0.9);
impact(SCENES.outro.from, 0.8);

// ── The patch ──

const PAD = [48, 51, 55, 58, 62];
add(music, at(SCENES.title.from), pad(PAD, stepToSeconds(SCENES.colour.to - SCENES.title.from), 0.08, 2.4), 0.5);
// A low bed under the editor scenes, so the patch never sounds thin.
add(music, at(SCENES.colour.from - 4), pad(PAD.map((m) => m - 12), stepToSeconds(BASS_IN - SCENES.colour.from + 6), 2.5, 1.5), 0.3);
add(music, at(BASS_IN - 2), pad(PAD.map((m) => m - 12), stepToSeconds(SCENES.write.to - BASS_IN + 2), 1.8, 2), 0.3);
add(music, at(SCENES.outro.from), pad(PAD, stepToSeconds(SCENES.outro.to - SCENES.outro.from) + 0.6, 0.05, 4.5), 0.55);

// Clock ticks from the colour scene, accented on the beat.
for (let s = SCENES.colour.from; s < MUSIC_TO; s++) {
  const fade = s > SCENES.outro.from ? Math.max(0, 1 - (s - SCENES.outro.from) / 40) : 1;
  add(music, at(s), tick(s % 4 === 0 ? 0.03 : 0.016), (s % 4 === 0 ? 0.16 : 0.09) * fade, 0.35);
}
// Kick on the beat once the patch is clean again; a backbeat rim in the duet.
for (let s = KICK_IN; s < SCENES.outro.from; s += 4) add(music, at(s), kick(), 0.42);
for (let s = BASS_IN; s < SCENES.outro.from; s += 8)
  if (s % 16 === 4 || s % 16 === 12) add(music, at(s), lowpass(tick(0.05), () => 2500, 1.4), 0.5, -0.25);

for (const n of notes()) {
  const fade = n.step > SCENES.outro.from ? Math.max(0, 1 - (n.step - SCENES.outro.from) / 44) : 1;
  if (n.voice === "lead") {
    const sig = pluck(n.midi, n.decay, 3800, 0.6);
    const pan = ((n.midi % 7) / 7 - 0.5) * 0.5;
    add(music, at(n.step), sig, 0.38 * n.velocity * fade, pan);
    add(send, at(n.step), sig, 0.16 * n.velocity * fade, pan);
  } else {
    add(music, at(n.step), pluck(n.midi, n.decay, 1300, 1.3), 0.5 * fade, 0);
  }
}

// Build, write and run.
add(fx, at(BUILD_CLICK), click(2400), 0.6, 0.2);
add(fx, at(BUILD_CLICK + 1), pluck(79, 0.3, 4000, 0.5), 0.18, 0.2);
add(fx, at(WRITE_CLICK), click(2400), 0.7, 0.3);
add(fx, at(WRITE_CLICK + 2), whoosh(stepToSeconds(WRITTEN - WRITE_CLICK - 2), 600, 4000), 0.12, 0.2);
add(fx, at(WRITTEN), pluck(84, 0.35, 5000, 0.6), 0.22, 0.1);
add(fx, at(WRITTEN + 1), pluck(91, 0.5, 5000, 0.8), 0.18, -0.1);
add(fx, at(RUNNING), whoosh(1.2, 6000, 300), 0.18);

// ── Ping-pong delay on the lead (3/16), then the error duck on the music ──

{
  const d = Math.round(3 * STEP_SECONDS * SR);
  const fb = 0.42;
  const [l, r] = send;
  const dl = new Float32Array(length);
  const dr = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const inL = l[i] + (i >= d ? dr[i - d] * fb : 0);
    const inR = r[i] + (i >= d ? dl[i - d] * fb : 0);
    dl[i] = inL;
    dr[i] = inR;
  }
  const wetL = lowpass(Float32Array.from(dl, (v, i) => (i >= d ? dl[i - d] : 0)), () => 2800);
  const wetR = lowpass(Float32Array.from(dr, (v, i) => (i >= d ? dr[i - d] : 0)), () => 2800);
  for (let i = 0; i < length; i++) {
    music[0][i] += wetR[i] * 0.55;
    music[1][i] += wetL[i] * 0.55;
  }
}

// While O9 is on screen the music sounds muffled, as if through a closed filter.
{
  const on = at(ERROR_ON);
  const off = at(ERROR_OFF);
  const glide = 0.25 * SR;
  const amount = (i: number) => Math.min(1, Math.max(0, (i - on) / glide)) * Math.min(1, Math.max(0, (off - i) / glide));
  for (const ch of music) {
    const out = lowpass(ch, (i) => 18000 * (1 - amount(i)) + 520 * amount(i), 0.8);
    ch.set(out);
  }
}

// ── Master: sum, measure loudness (ITU-R BS.1770), normalise to -14 LUFS, limit ──

const mix = [0, 1].map((c) => Float32Array.from(music[c], (v, i) => v + fx[c][i]));

function biquad(x: Float32Array, b: number[], a: number[]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}
function kWeight(x: Float32Array) {
  // Shelf (+4 dB above ~1.5 kHz) and high-pass (~38 Hz), designed for this rate.
  const shelf = (() => {
    const G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.974450955533;
    const K = Math.tan((Math.PI * fc) / SR);
    const Vh = 10 ** (G / 20), Vb = Vh ** 0.499666774155;
    const a0 = 1 + K / Q + K * K;
    return {
      b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
      a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    };
  })();
  const hp = (() => {
    const Q = 0.5003270373238773, fc = 38.13547087602444;
    const K = Math.tan((Math.PI * fc) / SR);
    const a0 = 1 + K / Q + K * K;
    return { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  })();
  return biquad(biquad(x, shelf.b, shelf.a), hp.b, hp.a);
}
function loudness(channels: Float32Array[]) {
  const k = channels.map(kWeight);
  const block = Math.round(0.4 * SR);
  const hop = Math.round(0.1 * SR);
  const powers: number[] = [];
  for (let s = 0; s + block <= length; s += hop) {
    let p = 0;
    for (const ch of k) for (let i = s; i < s + block; i++) p += ch[i] * ch[i];
    powers.push(p / block);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter((p) => lufs(p) > -70);
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  const rel = lufs(mean(abs)) - 10;
  return lufs(mean(abs.filter((p) => lufs(p) > rel)));
}

const TARGET = -14;
const CEILING = 10 ** (-1 / 20);
let gain = 10 ** ((TARGET - loudness(mix)) / 20);
let out = mix;
for (let pass = 0; pass < 3; pass++) {
  out = mix.map((ch) =>
    Float32Array.from(ch, (v) => {
      // Soft knee above -6 dBFS, hard ceiling at -1 dBFS.
      const x = v * gain;
      const knee = 0.5;
      const a = Math.abs(x);
      if (a <= knee) return x;
      return Math.sign(x) * (knee + (CEILING - knee) * Math.tanh((a - knee) / (CEILING - knee)));
    }),
  );
  gain *= 10 ** ((TARGET - loudness(out)) / 20);
}
const final = loudness(out);
// Fade the last half second.
const end = Math.ceil((DURATION_IN_FRAMES / FPS) * SR);
for (const ch of out)
  for (let i = 0; i < length; i++) {
    if (i >= end) ch[i] = 0;
    else if (i > end - 0.5 * SR) ch[i] *= (end - i) / (0.5 * SR);
  }

const wav = Buffer.alloc(44 + end * 4);
wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(36 + end * 4, 4);
wav.write("WAVEfmt ", 8, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(end * 4, 40);
let peak = 0;
for (let i = 0; i < end; i++)
  for (let c = 0; c < 2; c++) {
    peak = Math.max(peak, Math.abs(out[c][i]));
    wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[c][i] * 32767))), 44 + i * 4 + c * 2);
  }
mkdirSync(join(here, "..", "public"), { recursive: true });
writeFileSync(join(here, "..", "public", "soundtrack.wav"), wav);
console.log(
  `soundtrack.wav: ${(end / SR).toFixed(2)} s, ${notes().length} notes, ${final.toFixed(1)} LUFS, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`,
);
