// Context utilities shared by autocompletion and hover: they determine, for a
// given line, which circuit we are in and which controllers were declared above.

import * as vscode from "vscode";
import { DroidData } from "./data";

const HEADER_RE = /^\[([a-z0-9]+)\]$/;

export interface LineContext {
  /** Controllers declared (in order) above the line. */
  chain: string[];
  /** Known circuit active on the line, or null. */
  circuit: string | null;
  /** Are we inside an unknown circuit? */
  unknownCircuit: boolean;
}

/**
 * State (active circuit and controller chain) when reaching `targetLine`,
 * looking only at the headers located above it.
 */
export function contextAtLine(
  doc: vscode.TextDocument,
  targetLine: number,
  data: DroidData
): LineContext {
  const chain: string[] = [];
  let circuit: string | null = null;
  let unknownCircuit = false;
  let declaring = true;

  for (let i = 0; i < targetLine && i < doc.lineCount; i++) {
    const code = doc.lineAt(i).text.split("#")[0];
    const trimmed = code.trim();
    if (!trimmed) continue;

    const hm = trimmed.match(HEADER_RE);
    if (!hm) {
      declaring = false;
      continue;
    }
    const name = hm[1];
    if (data.controllers.has(name) && declaring) {
      chain.push(name);
      continue;
    }
    declaring = false;
    if (data.circuits.has(name)) {
      circuit = name;
      unknownCircuit = false;
    } else {
      circuit = null;
      unknownCircuit = true;
    }
  }

  return { chain, circuit, unknownCircuit };
}

/** Internal cables (_NAME) present anywhere in the document, deduplicated. */
export function cablesInDocument(doc: vscode.TextDocument): string[] {
  const set = new Set<string>();
  const re = /_[A-Za-z0-9_]+/g;
  for (let i = 0; i < doc.lineCount; i++) {
    const code = doc.lineAt(i).text.split("#")[0];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(code)) !== null) set.add(m[0]);
  }
  return [...set].sort();
}

/**
 * Parameter names already assigned in the circuit block containing `targetLine`.
 * Scans from the nearest header above down to (but not including) `targetLine`.
 */
export function paramsUsedInBlock(
  doc: vscode.TextDocument,
  targetLine: number
): Set<string> {
  const used = new Set<string>();
  const HEADER_RE = /^\[([a-z0-9]+)\]$/;
  const ASSIGN_RE = /^\s*([a-z][a-z0-9_]*)\s*=/i;

  // Find the header line above targetLine.
  let headerLine = -1;
  for (let i = targetLine - 1; i >= 0; i--) {
    const code = doc.lineAt(i).text.split("#")[0].trim();
    if (HEADER_RE.test(code)) { headerLine = i; break; }
  }
  if (headerLine < 0) return used;

  // Scan the whole block (until the next header or EOF), skipping targetLine.
  for (let i = headerLine + 1; i < doc.lineCount; i++) {
    const code = doc.lineAt(i).text.split("#")[0];
    const trimmed = code.trim();
    if (HEADER_RE.test(trimmed)) break; // next circuit block starts
    if (i === targetLine) continue;     // skip the line being edited
    const m = code.match(ASSIGN_RE);
    if (m) used.add(m[1].toLowerCase());
  }
  return used;
}

/**
 * Cables already assigned to output parameters anywhere in the document.
 * `excludeLine` is typically the line being edited (so the user can freely
 * change its assignment without seeing it excluded from suggestions).
 */
export function cablesUsedAsOutputs(
  doc: vscode.TextDocument,
  data: DroidData,
  excludeLine?: number
): Set<string> {
  const used = new Set<string>();
  const HEADER_RE = /^\[([a-z0-9]+)\]$/;
  const ASSIGN_RE = /^\s*([a-z][a-z0-9_]*)\s*=\s*(_[A-Za-z0-9_]+)/i;

  let currentCircuit: string | null = null;

  for (let i = 0; i < doc.lineCount; i++) {
    if (i === excludeLine) continue;
    const code = doc.lineAt(i).text.split("#")[0];
    const trimmed = code.trim();

    const hm = trimmed.match(HEADER_RE);
    if (hm) {
      currentCircuit = data.circuits.has(hm[1]) ? hm[1] : null;
      continue;
    }

    if (!currentCircuit) continue;

    const pm = code.match(ASSIGN_RE);
    if (!pm) continue;

    const rawParam = pm[1].toLowerCase();
    const base = rawParam.replace(/\d+$/, "");
    const cable = pm[2];

    const circuit = data.circuits.get(currentCircuit);
    if (!circuit) continue;

    const isOutput = (circuit.outputs ?? []).some(
      (o) => o.name === rawParam || o.name === base
    );
    if (isOutput) used.add(cable);
  }

  return used;
}
