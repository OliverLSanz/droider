// Linter logic: takes the text of a patch and returns a list of problems with
// their position (line/column). Does NOT depend on VSCode, so it can be tested
// in isolation. extension.ts turns these problems into VSCode diagnostics.
//
// The linter is mode-aware:
//   - "ini"       plain DROID patch ready for the card. No syntactic sugar:
//                 megacircuits and [input]/[output] sections are errors.
//   - "droider"   sugar allowed: megacircuits (blueprints) can be used like
//                 normal circuits and are validated against their port list.
//   - "blueprint" a megacircuit definition: adds the [input]/[output] sections
//                 and treats their cables as the boundary of the sub-patch.

import { DroidData, ParamRole, ParamSpec } from "./data";
import { lintLabels } from "./labels";
import { Blueprint, blueprintCycle } from "./blueprints";
import { isComplexExpression, expressionError } from "./maths";

export type PatchMode = "ini" | "droider" | "blueprint";

export interface Problem {
  line: number; // 0-based
  startCol: number;
  endCol: number;
  message: string;
  severity: "error" | "warning";
}

export interface LintOptions {
  mode?: PatchMode;
  blueprints?: Map<string, Blueprint>;
}

interface Pos {
  line: number;
  col: number;
  endCol: number;
}

/** Maps a VSCode languageId to the patch mode. */
export function modeForLanguageId(id: string): PatchMode {
  if (id === "droider") return "droider";
  if (id === "droid-blueprint") return "blueprint";
  return "ini";
}

/** Maps a file path/extension to the patch mode (for the CLI). */
export function modeForFile(path: string): PatchMode {
  if (path.endsWith(".droider")) return "droider";
  if (path.endsWith(".blueprint")) return "blueprint";
  return "ini";
}

const HEADER_RE = /^\[([a-z0-9]+)\]$/;
const PNAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
const ARRAY_RE = /^([a-zA-Z]+)(\d+)$/;
const TOKEN_SPLIT = /[*+\-/()]/;

type BlockKind = "circuit" | "blueprint" | "section-input" | "section-output" | "unknown" | "none";

export function lint(text: string, data: DroidData, opts: LintOptions = {}): Problem[] {
  const mode: PatchMode = opts.mode ?? "ini";
  const blueprints = opts.blueprints ?? new Map<string, Blueprint>();
  const sugarAllowed = mode !== "ini";

  const problems: Problem[] = [];
  const lines = text.split(/\r?\n/);

  const chain: string[] = []; // controller types in declaration order
  let kind: BlockKind = "none";
  let curCircuit: string | null = null;
  let curIndex: Map<string, { role: ParamRole; spec: ParamSpec }> | null = null;
  let curPorts: Map<string, ParamRole> | null = null; // blueprint instance ports
  let declaring = true; // are we still in the initial controller block?

  // For the internal patch cable rules.
  const cableOut = new Map<string, Pos[]>();
  const cableIn = new Map<string, Pos[]>();

  // Pending megacircuit instance, flushed at the next header / EOF to check
  // that every required input port was wired.
  let pending: {
    bp: Blueprint;
    line: number;
    col: number;
    len: number;
    seen: Set<string>;
  } | null = null;
  const seenPortNames = new Set<string>(); // duplicate-port detection in sections

  // Blueprint-mode port tracking: declared ports and how the body uses them.
  const portRoles = new Map<string, ParamRole>();
  const portDecl = new Map<string, Pos>(); // declaration position, for messages
  const portProducers = new Map<string, number>(); // times assigned as output
  const portConsumers = new Map<string, number>(); // times read as input

  const add = (
    line: number,
    startCol: number,
    endCol: number,
    message: string,
    severity: "error" | "warning" = "error"
  ) => problems.push({ line, startCol, endCol, message, severity });

  const flushPending = () => {
    if (!pending) return;
    for (const port of pending.bp.inputs) {
      // Inputs with a default are optional; the rest must be wired.
      if (port.default === undefined && !pending.seen.has(port.name)) {
        add(pending.line, pending.col, pending.col + pending.len,
          `megacircuit [${pending.bp.name}] is missing input '${port.name}'`);
      }
    }
    pending = null;
  };

  lines.forEach((raw, i) => {
    // Strip the comment but keep the original column positions.
    const code = raw.split("#")[0];
    const trimmed = code.trim();
    if (!trimmed) return;

    // --- Header [something] ---
    const hm = trimmed.match(HEADER_RE);
    if (hm) {
      flushPending();
      const name = hm[1];
      const col = code.indexOf("[");
      const headerEnd = col + hm[0].length;

      if (data.controllers.has(name) && declaring) {
        chain.push(name);
        return;
      }
      declaring = false;
      curCircuit = null;
      curIndex = null;
      curPorts = null;

      // [input] / [output] sections (blueprint files only).
      if (name === "input" || name === "output") {
        if (mode === "blueprint") {
          kind = name === "input" ? "section-input" : "section-output";
        } else {
          add(i, col, headerEnd,
            `[${name}] sections are only allowed in .blueprint files`);
          kind = "unknown";
        }
        return;
      }

      // Megacircuit (blueprint) instance.
      if (blueprints.has(name)) {
        if (!sugarAllowed) {
          add(i, col, headerEnd,
            `megacircuit [${name}] is not allowed in .ini files; use a .droider file`);
          kind = "unknown";
          return;
        }
        const bp = blueprints.get(name)!;
        kind = "blueprint";
        curPorts = new Map<string, ParamRole>();
        for (const p of bp.inputs) curPorts.set(p.name, "input");
        for (const p of bp.outputs) curPorts.set(p.name, "output");
        pending = { bp, line: i, col, len: hm[0].length, seen: new Set() };
        if (blueprintCycle(name, blueprints)) {
          add(i, col, headerEnd, `megacircuit [${name}] has a cyclic reference`);
        }
        return;
      }

      // Known standard circuit.
      if (data.circuits.has(name)) {
        kind = "circuit";
        curCircuit = name;
        curIndex = data.paramIndex(data.circuits.get(name)!);
        return;
      }

      // Unknown.
      const extra = name === "math" ? " (not yet extracted to YAML)" : "";
      const msg = data.controllers.has(name)
        ? `controller [${name}] declared outside the initial block`
        : `unknown circuit: [${name}]${extra}`;
      add(i, col, headerEnd, msg);
      kind = "unknown";
      return;
    }
    declaring = false;

    // --- Blueprint [input]/[output] section entry: name [= default] ---
    if (kind === "section-input" || kind === "section-output") {
      const m = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(=\s*(.*))?$/);
      if (!m) {
        add(i, firstNonSpace(code), code.length, `invalid port declaration`);
        return;
      }
      const portName = m[1];
      const pStart = code.indexOf(portName);
      const role: ParamRole = kind === "section-input" ? "input" : "output";
      if (seenPortNames.has(portName)) {
        add(i, pStart, pStart + portName.length, `duplicate port name '${portName}'`);
      } else {
        seenPortNames.add(portName);
        portRoles.set(portName, role);
        portDecl.set(portName, { line: i, col: pStart, endCol: pStart + portName.length });
      }
      if (m[2] !== undefined && role === "output") {
        const eqCol = code.indexOf("=");
        add(i, eqCol, code.length, `output ports cannot have a default value`);
      } else if (m[2] !== undefined) {
        // Validate the default value's registers (defaults are usually constants).
        const def = m[3] ?? "";
        const validRegs = data.validRegisters(chain);
        for (const part of splitTokens(def)) {
          const cls = classify(part);
          if (cls?.kind === "register" && !validRegs.has(cls.tok)) {
            const col = code.indexOf(part, code.indexOf("=") + 1);
            add(i, col, col + part.length, `unknown register in default: ${cls.tok}`);
          }
        }
      }
      return;
    }

    // --- Parameter line: name = value ---
    const eq = code.indexOf("=");
    if (eq < 0) {
      add(i, firstNonSpace(code), code.length, `missing '=' in parameter line`);
      return;
    }
    const pname = code.slice(0, eq).trim();
    const pStart = code.indexOf(pname);
    if (!PNAME_RE.test(pname)) {
      add(i, pStart, pStart + pname.length, `invalid parameter name: '${pname}'`);
      return;
    }

    // Determine the role of the parameter (input/output), if known.
    let role: ParamRole | null = null;
    if (kind === "circuit" && curCircuit && curIndex) {
      const entry = curIndex.get(pname);
      if (entry) {
        role = entry.role;
      } else {
        const mb = pname.match(ARRAY_RE);
        const base = mb ? curIndex.get(mb[1]) : undefined;
        if (mb && base && base.spec.array && Number(mb[2]) <= base.spec.array) {
          role = base.role;
        } else if (mb && base) {
          add(i, pStart, pStart + pname.length,
            `array index out of range: '${pname}' in [${curCircuit}]`);
        } else {
          add(i, pStart, pStart + pname.length,
            `unknown parameter '${pname}' in [${curCircuit}]`);
        }
      }
    } else if (kind === "blueprint" && curPorts) {
      const r = curPorts.get(pname);
      if (r) {
        role = r;
        if (pending) pending.seen.add(pname);
      } else {
        add(i, pStart, pStart + pname.length,
          `unknown port '${pname}' in megacircuit [${pending?.bp.name}]`);
      }
    }

    // --- Registers and internal cables in the value ---
    const valueStart = eq + 1;
    const value = code.slice(valueStart);
    const validRegs = data.validRegisters(chain);

    // A malformed math expression (bad operators/parens) is an error in any
    // mode — otherwise it would slip through unchanged into an invalid .ini.
    // A well-formed expression beyond DROID's native `A * B + C` is fine in
    // .droider/.blueprint (it is sugar) but rejected in a plain .ini.
    const exprErr = expressionError(value);
    if (exprErr) {
      const col = firstNonSpace(value) + valueStart;
      add(i, col, code.length, exprErr);
    } else if (mode === "ini" && isComplexExpression(value)) {
      const col = firstNonSpace(value) + valueStart;
      add(i, col, code.length,
        `math expression '${value.trim()}' is beyond DROID's native A * B + C; ` +
        `use a .droider file (only A * B + C is allowed in .ini)`);
    }

    for (const part of splitTokens(value)) {
      const cls = classify(part);
      if (!cls) continue;
      const col = code.indexOf(part, valueStart);
      const pos: Pos = { line: i, col, endCol: col + part.length };

      if (cls.kind === "cable") {
        const bucket = role === "output" ? cableOut : cableIn;
        const list = bucket.get(cls.tok);
        if (list) list.push(pos);
        else bucket.set(cls.tok, [pos]);
      } else if (cls.kind === "register") {
        // In a blueprint body, a bare identifier may be a declared port rather
        // than a hardware register; track how it is used.
        if (mode === "blueprint" && portRoles.has(cls.tok)) {
          const map = role === "output" ? portProducers : portConsumers;
          map.set(cls.tok, (map.get(cls.tok) ?? 0) + 1);
          continue;
        }
        const info = validRegs.get(cls.tok);
        if (!info) {
          add(i, col, col + part.length, `unknown register: ${cls.tok}`);
        } else if (role === "output" && info.direction === "input") {
          add(i, col, col + part.length,
            `input-only register '${cls.tok}' used as an output`);
        }
      }
    }
  });

  flushPending();

  // --- Internal patch cable rules ---
  const cables = new Set<string>([...cableOut.keys(), ...cableIn.keys()]);
  for (const cable of cables) {
    const outs = cableOut.get(cable) ?? [];
    const ins = cableIn.get(cable) ?? [];
    if (outs.length > 1) {
      const p = outs[1];
      add(p.line, p.col, p.endCol, `internal cable '${cable}' used as an output more than once`);
    }
    if (outs.length === 0) {
      const p = ins[0];
      add(p.line, p.col, p.endCol, `internal cable '${cable}' has no output (nothing writes to it)`);
    }
    if (ins.length === 0) {
      const p = outs[0];
      add(p.line, p.col, p.endCol, `internal cable '${cable}' has no input (nothing reads from it)`);
    }
  }

  // --- Blueprint port flow rules ---
  for (const [name, role] of portRoles) {
    const prod = portProducers.get(name) ?? 0;
    const cons = portConsumers.get(name) ?? 0;
    const d = portDecl.get(name)!;
    if (role === "output") {
      if (prod === 0) {
        add(d.line, d.col, d.endCol, `output port '${name}' is never produced by the blueprint body`);
      } else if (prod > 1) {
        add(d.line, d.col, d.endCol, `output port '${name}' is produced more than once`);
      }
    } else {
      if (prod > 0) {
        add(d.line, d.col, d.endCol, `input port '${name}' must not be assigned as an output`);
      }
      if (cons === 0) {
        add(d.line, d.col, d.endCol, `input port '${name}' is never used in the blueprint body`, "warning");
      }
    }
  }

  // --- Droid Forge label legend (leading comment block) ---
  problems.push(...lintLabels(text, data));

  return problems;
}

function splitTokens(value: string): string[] {
  if (value.trim().startsWith('"')) return []; // text: no registers to validate
  return value.split(TOKEN_SPLIT);
}

function classify(tok: string): { kind: string; tok: string } | null {
  tok = tok.trim();
  if (!tok) return null;
  if (tok === "on" || tok === "off") return { kind: "number", tok };
  if (tok.startsWith('"')) return { kind: "text", tok };
  if (tok.startsWith("_")) return { kind: "cable", tok };
  const num = tok.replace(/[V%]+$/, "");
  if (num !== "" && !isNaN(Number(num))) return { kind: "number", tok };
  return { kind: "register", tok };
}

function firstNonSpace(s: string): number {
  const m = s.match(/\S/);
  return m ? m.index! : 0;
}
