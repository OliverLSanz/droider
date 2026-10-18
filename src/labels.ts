// Droid Forge label legend: a block of comments at the top of the patch that
// the Forge reads to show labels on the jacks and controls.
//
//   # LABELS: master=16
//   # INPUTS:
//   #  I1: [ENV TRIG] long description
//   #  I4: [1VOCT]
//   # OUTPUTS:
//   #  O4: [VOCT COPY] another description
//   # GATES ON MODULE 1:
//   #  G1: [TRIG] Envelope trigger
//   # CONTROLLER 1:
//   #  S1.1: [shrt] description of a pot
//
// Both the short label between [brackets] and the long description are
// optional. This logic is pure (VSCode-free): used by the linter, the CLI and
// the autocompletion.

import type { Problem } from "./linter";
import { DroidData } from "./data";

const SEC_LABELS = /^#\s*LABELS:\s*/;
const SEC_INPUTS = /^#\s*INPUTS:\s*$/;
const SEC_OUTPUTS = /^#\s*OUTPUTS:\s*$/;
const SEC_CONTROLLER = /^#\s*CONTROLLER\s+(\d+):\s*$/;
const SEC_GATES_MODULE = /^#\s*GATES ON MODULE\s+([1-9]\d*):\s*$/;
const SEC_GATES_X7 = /^#\s*GATES ON X7:\s*$/;
const ENTRY =
  /^#\s+([A-Za-z][A-Za-z0-9]*(?:\.\d+)?):\s*(?:\[([^\]]*)\])?\s*(.*?)\s*$/;

const LABEL_MAX = 5;

export interface LabelSection {
  kind: "inputs" | "outputs" | "controller" | "gates";
  controller?: number;
  gateModule?: number; // Undefined for the separate X7 gate section.
}

function sectionHeader(line: string): LabelSection | null {
  if (SEC_INPUTS.test(line)) return { kind: "inputs" };
  if (SEC_OUTPUTS.test(line)) return { kind: "outputs" };
  if (SEC_GATES_X7.test(line)) return { kind: "gates" };
  const gate = line.match(SEC_GATES_MODULE);
  if (gate) return { kind: "gates", gateModule: Number(gate[1]) };
  const controller = line.match(SEC_CONTROLLER);
  return controller ? { kind: "controller", controller: Number(controller[1]) } : null;
}

/** The gate aliases used in Forge's GATES ON MODULE / GATES ON X7 legend. */
export function matchesGateLabelSection(section: LabelSection, register: string): boolean {
  if (section.kind !== "gates") return false;
  if (section.gateModule === undefined) return /^G(?:9|1[0-2])$/.test(register);
  if (section.gateModule === 1 && /^G[1-8]$/.test(register)) return true;
  return new RegExp(`^G${section.gateModule}\\.[1-8]$`).test(register);
}

/** Forge label legend for one register: short [label] and/or long description. */
export interface LabelInfo {
  label?: string;
  description?: string;
}

/**
 * Parses the Droid Forge label legend at the top of a patch into a map from
 * register (I1, O2, P3.1...) to its short label and/or description. Empty if
 * the patch has no `# LABELS:` header. Pure (VSCode-free).
 */
export function parseLabelLegend(text: string): Map<string, LabelInfo> {
  const lines = text.split(/\r?\n/);
  const end = labelRegion(lines);
  const out = new Map<string, LabelInfo>();
  if (end < 0) return out;
  for (let i = 0; i < end; i++) {
    const raw = lines[i];
    // Skip section headers (they would otherwise match ENTRY, e.g. "INPUTS:").
    if (
      SEC_LABELS.test(raw) ||
      sectionHeader(raw)
    )
      continue;
    const m = raw.match(ENTRY);
    if (!m) continue;
    out.set(m[1], { label: m[2] || undefined, description: m[3] || undefined });
  }
  return out;
}

/**
 * End (exclusive) of the label region: the leading block of comments and blank
 * lines. -1 if there is no `# LABELS:` header (then there is no legend).
 */
function labelRegion(lines: string[]): number {
  let hasLabels = false;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "" || t.startsWith("#")) {
      if (SEC_LABELS.test(lines[i])) hasLabels = true;
    } else {
      end = i;
      break;
    }
  }
  return hasLabels ? end : -1;
}

/** Label section that governs line `idx`, or null if it does not apply. */
export function labelSectionAtLine(
  lines: string[],
  idx: number
): LabelSection | null {
  const end = labelRegion(lines);
  if (end < 0 || idx >= end) return null;
  let sec: LabelSection | null = null;
  for (let i = 0; i <= idx && i < end; i++) {
    const header = sectionHeader(lines[i]);
    if (header) sec = header;
  }
  return sec;
}

/** The controller number a register like `S1.1` or `P3.2` belongs to. */
function controllerOf(reg: string): number | null {
  const m = reg.match(/^[A-Za-z]+(\d+)\./);
  return m ? Number(m[1]) : null;
}

export function lintLabels(text: string, data: DroidData): Problem[] {
  const lines = text.split(/\r?\n/);
  const end = labelRegion(lines);
  if (end < 0) return [];

  const chain = data.controllerChain(lines);
  const problems: Problem[] = [];
  let section: LabelSection | null = null;

  for (let i = 0; i < end; i++) {
    const raw = lines[i];

    // Section headers.
    if (SEC_LABELS.test(raw)) continue;
    const header = sectionHeader(raw);
    if (header) {
      section = header;
      continue;
    }

    // Label entries.
    const m = raw.match(ENTRY);
    if (!m) continue;
    const reg = m[1];
    const label = m[2]; // may be undefined
    const regStart = raw.indexOf(reg, raw.indexOf("#") + 1);
    const regEnd = regStart + reg.length;

    const add = (
      startCol: number,
      endCol: number,
      message: string,
      severity: "error" | "warning"
    ) => problems.push({ line: i, startCol, endCol, message, severity });

    if (!section) {
      add(regStart, regEnd, `label outside a section (INPUTS/OUTPUTS/GATES/CONTROLLER)`, "warning");
    }

    // The register must exist for this hardware.
    const info = data.registerInfo(reg, chain);
    if (!info) {
      add(regStart, regEnd, `label for a non-existent register: ${reg}`, "error");
    } else if (section) {
      // Consistency with the section.
      if (section.kind === "inputs" && !/^I\d+$/.test(reg)) {
        add(regStart, regEnd, `INPUTS expects master inputs (I1…); '${reg}' is not one`, "warning");
      } else if (section.kind === "outputs" && !/^O\d+$/.test(reg)) {
        add(regStart, regEnd, `OUTPUTS expects master outputs (O1…); '${reg}' is not one`, "warning");
      } else if (section.kind === "gates" && !matchesGateLabelSection(section, reg)) {
        const title = section.gateModule === undefined ? "GATES ON X7" : `GATES ON MODULE ${section.gateModule}`;
        add(regStart, regEnd, `'${reg}' does not belong to ${title}`, "warning");
      } else if (section.kind === "controller") {
        const c = controllerOf(reg);
        if (c !== section.controller) {
          add(regStart, regEnd, `'${reg}' does not belong to CONTROLLER ${section.controller}`, "warning");
        }
      }
    }

    // Length of the short label (recommendation, not mandatory).
    if (label !== undefined && label.length > LABEL_MAX) {
      const lb = raw.indexOf("[", regEnd);
      if (lb >= 0) {
        add(lb + 1, lb + 1 + label.length, `label is ${label.length} characters (recommended ≤${LABEL_MAX}; longer ones don't display well in the Forge)`, "warning");
      }
    }
  }

  return problems;
}
