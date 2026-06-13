// Linter logic: takes the text of a patch and returns a list of problems with
// their position (line/column). Does NOT depend on VSCode, so it can be tested
// in isolation. extension.ts turns these problems into VSCode diagnostics.

import { DroidData, ParamRole, ParamSpec } from "./data";
import { lintLabels } from "./labels";

export interface Problem {
  line: number; // 0-based
  startCol: number;
  endCol: number;
  message: string;
  severity: "error" | "warning";
}

interface Pos {
  line: number;
  col: number;
  endCol: number;
}

const HEADER_RE = /^\[([a-z0-9]+)\]$/;
const PNAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
const ARRAY_RE = /^([a-zA-Z]+)(\d+)$/;
const TOKEN_SPLIT = /[*+\-/]/;

export function lint(text: string, data: DroidData): Problem[] {
  const problems: Problem[] = [];
  const lines = text.split(/\r?\n/);

  const chain: string[] = []; // controller types in declaration order
  let curCircuit: string | null = null;
  let curIndex: Map<string, { role: ParamRole; spec: ParamSpec }> | null = null;
  let declaring = true; // are we still in the initial controller block?

  // For the internal patch cable rules.
  const cableOut = new Map<string, Pos[]>();
  const cableIn = new Map<string, Pos[]>();

  const add = (
    line: number,
    startCol: number,
    endCol: number,
    message: string,
    severity: "error" | "warning" = "error"
  ) => problems.push({ line, startCol, endCol, message, severity });

  lines.forEach((raw, i) => {
    // Strip the comment but keep the original column positions.
    const code = raw.split("#")[0];
    const trimmed = code.trim();
    if (!trimmed) return;

    // --- Header [something] ---
    const hm = trimmed.match(HEADER_RE);
    if (hm) {
      const name = hm[1];
      const col = code.indexOf("[");
      if (data.controllers.has(name) && declaring) {
        chain.push(name);
        return;
      }
      declaring = false;
      if (!data.circuits.has(name)) {
        const extra = name === "math" ? " (not yet extracted to YAML)" : "";
        const msg = data.controllers.has(name)
          ? `controller [${name}] declared outside the initial block`
          : `unknown circuit: [${name}]${extra}`;
        add(i, col, col + hm[0].length, msg);
        curCircuit = null;
        curIndex = null;
      } else {
        curCircuit = name;
        curIndex = data.paramIndex(data.circuits.get(name)!);
      }
      return;
    }
    declaring = false;

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

    // Is the parameter known in the current circuit?
    let role: ParamRole | null = null;
    if (curCircuit && curIndex) {
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
    }

    // --- Registers and internal cables in the value ---
    const valueStart = eq + 1;
    const value = code.slice(valueStart);
    const validRegs = data.validRegisters(chain);

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
