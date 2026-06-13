// "Rainbow" coloring of internal cables: each cable name (_FOO) gets its own
// stable color, and all of its occurrences look the same.
//
// This CANNOT be done with semantic tokens (they have a fixed palette of
// types), so we use VSCode's decoration API, which allows an arbitrary color
// per range. The color is derived from the name with a hash -> HSL hue, so it
// is deterministic (the same cable always gets the same color).

import * as vscode from "vscode";
import { DroidData } from "./data";

const HEADER_RE = /^\[([a-z0-9]+)\]$/;
const CABLE_RE = /_[A-Za-z0-9_]+/g;

interface Occurrence {
  name: string;
  range: vscode.Range;
}

/**
 * Cable occurrences on the value side of parameters, ignoring unknown circuits
 * (whose content is shown dimmed and unverified).
 */
export function findCableOccurrences(
  doc: vscode.TextDocument,
  data: DroidData
): Occurrence[] {
  const out: Occurrence[] = [];
  let declaring = true;
  let inUnknownCircuit = false;

  const lines = doc.getText().split(/\r?\n/);
  lines.forEach((raw, i) => {
    const code = raw.split("#")[0];
    const trimmed = code.trim();
    if (!trimmed) return;

    const hm = trimmed.match(HEADER_RE);
    if (hm) {
      const name = hm[1];
      if (data.controllers.has(name) && declaring) return;
      declaring = false;
      inUnknownCircuit = !data.circuits.has(name);
      return;
    }
    declaring = false;
    if (inUnknownCircuit) return;

    const eq = code.indexOf("=");
    if (eq < 0) return;
    const valueStart = eq + 1;
    const value = code.slice(valueStart);

    let m: RegExpExecArray | null;
    CABLE_RE.lastIndex = 0;
    while ((m = CABLE_RE.exec(value)) !== null) {
      const start = valueStart + m.index;
      out.push({
        name: m[0],
        range: new vscode.Range(i, start, i, start + m[0].length),
      });
    }
  });
  return out;
}

/** Stable hex color for a cable name. */
export function colorForCable(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hslToHex(h % 360, 70, 62);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Applies and maintains the cable color decorations in the editors. Caches one
 * decoration type per color so they can be reused and the unused ones cleared.
 */
export class CableDecorator {
  private cache = new Map<string, vscode.TextEditorDecorationType>();

  constructor(private data: DroidData) {}

  private typeFor(color: string): vscode.TextEditorDecorationType {
    let t = this.cache.get(color);
    if (!t) {
      t = vscode.window.createTextEditorDecorationType({ color });
      this.cache.set(color, t);
    }
    return t;
  }

  decorate(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== "droid") return;

    const byColor = new Map<string, vscode.Range[]>();
    for (const occ of findCableOccurrences(editor.document, this.data)) {
      const color = colorForCable(occ.name);
      let ranges = byColor.get(color);
      if (!ranges) {
        ranges = [];
        byColor.set(color, ranges);
      }
      ranges.push(occ.range);
    }

    // Make sure a decoration type exists for every color used...
    for (const color of byColor.keys()) this.typeFor(color);
    // ...and apply the decorations, clearing (empty ranges) the unused ones.
    for (const [color, type] of this.cache) {
      editor.setDecorations(type, byColor.get(color) ?? []);
    }
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
  }
}
