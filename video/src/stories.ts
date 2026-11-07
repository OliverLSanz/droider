// What is typed on screen, keystroke by keystroke. The scenes show these states,
// the soundtrack clicks on the keystrokes, and scripts/gen-data.ts lints every
// state with the real linter so the squiggles and counts are the extension's own.
import { HOOK } from "./score.ts";

/** A caret marker inside the text of a state. */
export const CARET = "‸";

export interface State {
  /** Scene-local step where this state appears. */
  at: number;
  /** Text of the edited block, with CARET where the caret is. */
  block: string;
  /** The suggest widget, if open. `filter` is the word typed since it opened. */
  suggest?: { list: SuggestList; filter: string; selected: number };
}
export type SuggestList = "header" | "contour" | "contour1" | "contour4" | "cables" | "registers";

// ── Hook: the typo, in a plain text editor ──

export const HOOK_LINE = "    output  = O9";
const HOOK_TYPED_FROM = 4; // the indentation is already there

/** Characters of the typo line visible at a step of the hook. */
export function hookTyped(step: number) {
  const chars = HOOK_LINE.length - HOOK_TYPED_FROM;
  const t = (step - HOOK.typeFrom) / (HOOK.typeTo - HOOK.typeFrom);
  return HOOK_LINE.slice(0, HOOK_TYPED_FROM + Math.max(0, Math.min(chars, Math.floor(t * chars + 0.001))));
}
export function hookKeystrokes() {
  const chars = HOOK_LINE.length - HOOK_TYPED_FROM;
  return Array.from({ length: chars }, (_, i) => ({
    at: HOOK.typeFrom + ((i + 1) / chars) * (HOOK.typeTo - HOOK.typeFrom) - 0.001,
    space: HOOK_LINE[HOOK_TYPED_FROM + i] === " ",
  }));
}

// ── Autocomplete: writing the [contour] block of melody.ini ──

const C = CARET;
const typed = (at: number, prefix: string, word: string, perChar: number, rest = "", suggest?: (f: string) => State["suggest"]): State[] =>
  Array.from({ length: word.length }, (_, i) => ({
    at: at + i * perChar,
    block: prefix + word.slice(0, i + 1) + C + rest,
    suggest: suggest?.(word.slice(0, i + 1)),
  }));

const T = "[contour]\n    trigger = _GATE\n";
const ADS = ["    attack = 0.01", "    decay = 0.25", "    sustain = 0"];

export const completeStates: State[] = [
  { at: 0, block: C },
  { at: 2, block: `[${C}]`, suggest: { list: "header", filter: "", selected: 0 } },
  ...typed(4.5, "[", "con", 1.6, "]", (f) => ({ list: "header", filter: f, selected: 0 })),
  // Enter: the snippet writes the header, indents, and asks for the parameters.
  { at: 10, block: `[contour]\n    ${C}`, suggest: { list: "contour", filter: "", selected: 0 } },
  ...typed(12.5, "[contour]\n    ", "tr", 1.4, "", (f) => ({ list: "contour", filter: f, selected: 0 })),
  { at: 16, block: `[contour]\n    trigger = ${C}` },
  { at: 18, block: `[contour]\n    trigger = _${C}`, suggest: { list: "cables", filter: "_", selected: 0 } },
  { at: 20, block: `[contour]\n    trigger = _${C}`, suggest: { list: "cables", filter: "_", selected: 1 } },
  { at: 22, block: `[contour]\n    trigger = _GATE${C}` },
  // Enter after a parameter: same indent, and the remaining parameters.
  { at: 24, block: `${T}    ${C}`, suggest: { list: "contour1", filter: "", selected: 0 } },
  // A quick run through attack, decay and sustain.
  ...ADS.flatMap((line, k) =>
    typed(26 + k * 3, T + ADS.slice(0, k).map((l) => l + "\n").join("") + "    ", line.trim(), 2.6 / line.trim().length),
  ),
  { at: 35, block: `${T}${ADS.join("\n")}\n    ${C}`, suggest: { list: "contour4", filter: "", selected: 0 } },
  { at: 37, block: `${T}${ADS.join("\n")}\n    o${C}`, suggest: { list: "contour4", filter: "o", selected: 0 } },
  { at: 39, block: `${T}${ADS.join("\n")}\n    output = ${C}` },
  { at: 41.5, block: `${T}${ADS.join("\n")}\n    output = O${C}`, suggest: { list: "registers", filter: "O", selected: 0 } },
  { at: 43.5, block: `${T}${ADS.join("\n")}\n    output = O${C}`, suggest: { list: "registers", filter: "O", selected: 1 } },
  { at: 45, block: `${T}${ADS.join("\n")}\n    output = O${C}`, suggest: { list: "registers", filter: "O", selected: 2 } },
  { at: 47, block: `${T}${ADS.join("\n")}\n    output = O3${C}` },
];

/** melody.ini with the [contour] block replaced by `block` (the document while it is written). */
export function completeDoc(melody: string, block: string) {
  const lines = melody.split("\n");
  const start = lines.indexOf("[contour]");
  const end = lines.indexOf("[copy]") - 1; // keep the blank line before [copy]
  return [...lines.slice(0, start), ...block.split("\n"), ...lines.slice(end)].join("\n");
}

/** Line of the document where the edited block starts. */
export const blockStart = (melody: string) => melody.split("\n").indexOf("[contour]");

/** Splits a state into its text and caret position. */
export function caretOf(text: string): { text: string; line: number; col: number } {
  const i = text.indexOf(CARET);
  const before = text.slice(0, i).split("\n");
  return { text: text.replace(CARET, ""), line: before.length - 1, col: before[before.length - 1].length };
}

export function stateAt(states: State[], local: number) {
  let current = states[0];
  for (const s of states) if (s.at <= local) current = s;
  return current;
}

// ── Live errors: O3 becomes O9 and back ──

/** Text of the contour output line through the error scene (scene-local steps). */
export const errorStates: { at: number; value: string }[] = [
  { at: 0, value: "O3" },
  { at: 7, value: "O" },
  { at: 9, value: "O9" },
  { at: 29, value: "O" },
  { at: 31, value: "O3" },
];
