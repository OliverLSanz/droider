// Loads and represents the DROID language data from the YAML files
// (circuits/*.yaml, registers.yaml, controllers.yaml).
//
// This layer does NOT depend on VSCode: it is pure, reusable logic (the same a
// language server, tests, etc. would use).

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface ParamSpec {
  name: string;
  abbr?: string | null;
  valuetype?: string;
  default?: unknown;
  min?: number;
  max?: number;
  unit?: string;
  array?: number;
  description: string;
}

export interface Circuit {
  name: string;
  title: string;
  description: string;
  inputs?: ParamSpec[];
  outputs?: ParamSpec[];
}

export interface ControllerElement {
  register: string;
  kind: string;
  direction: "input" | "output" | "special";
  valuetype?: string;
  description: string;
  count?: number;
  index?: { min: number; max: number };
}

export interface Controller {
  type: string;
  title: string;
  description: string;
  elements: ControllerElement[];
}

type Direction = "input" | "output" | "inout" | "special";
export type ParamRole = "input" | "output";

/** Information about a concrete register (already resolved, e.g. "O3" or "P3.2"). */
export interface RegisterInfo {
  direction: Direction;
  description: string;
  valuetype?: string;
  /** Extra hardware required (g8/x7), if any. */
  requires?: string | null;
}

interface RegisterFamily {
  prefix: string;
  shape: "indexed" | "single" | "dotted";
  direction: Direction;
  description: string;
  valuetype?: string;
  requires?: string | null;
  index?: { min: number; max: number };
  group?: { min: number; max: number };
  element?: { min: number; max: number };
}

export class DroidData {
  circuits = new Map<string, Circuit>();
  controllers = new Map<string, Controller>();
  /** Fixed master registers: name -> info. */
  masterRegs = new Map<string, RegisterInfo>();
  /** Per-circuit parameter index cache. */
  private paramIndexCache = new Map<
    string,
    Map<string, { role: ParamRole; spec: ParamSpec }>
  >();

  /**
   * Locates the data folder by searching for registers.yaml upwards from each
   * candidate directory (e.g. the extension folder or the open workspace).
   */
  static findDataDir(searchDirs: string[]): string {
    for (const base of searchDirs) {
      let dir = base;
      for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, "registers.yaml"))) {
          return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    throw new Error(
      "registers.yaml not found starting from: " + searchDirs.join(", ")
    );
  }

  static load(searchDirs: string[]): DroidData {
    const dir = DroidData.findDataDir(searchDirs);
    const d = new DroidData();

    const circuitsDir = path.join(dir, "circuits");
    for (const f of fs.readdirSync(circuitsDir)) {
      if (!f.endsWith(".yaml")) continue;
      const c = yaml.load(
        fs.readFileSync(path.join(circuitsDir, f), "utf8")
      ) as Circuit;
      d.circuits.set(c.name, c);
    }

    const ctl = yaml.load(
      fs.readFileSync(path.join(dir, "controllers.yaml"), "utf8")
    ) as { controllers: Controller[] };
    for (const c of ctl.controllers) {
      d.controllers.set(c.type, c);
    }

    const regs = yaml.load(
      fs.readFileSync(path.join(dir, "registers.yaml"), "utf8")
    ) as { masters: Record<string, { registers: RegisterFamily[] }> };
    d.masterRegs = expandMaster(regs, "master");

    return d;
  }

  /**
   * Parameter index for a circuit: name or abbreviation -> role + spec.
   * Cached because it is queried a lot (linter and semantic highlighting).
   */
  paramIndex(circuit: Circuit): Map<string, { role: ParamRole; spec: ParamSpec }> {
    const cached = this.paramIndexCache.get(circuit.name);
    if (cached) return cached;
    const idx = new Map<string, { role: ParamRole; spec: ParamSpec }>();
    const register = (params: ParamSpec[] | undefined, role: ParamRole) => {
      for (const p of params ?? []) {
        idx.set(p.name, { role, spec: p });
        if (p.abbr) idx.set(p.abbr, { role, spec: p });
      }
    };
    register(circuit.inputs, "input");
    register(circuit.outputs, "output");
    this.paramIndexCache.set(circuit.name, idx);
    return idx;
  }

  /**
   * Resolves a circuit parameter (long form, abbreviation, or array such as
   * `output3` -> base `output`). undefined if it does not exist.
   */
  paramLookup(
    circuitName: string,
    pname: string
  ): { role: ParamRole; spec: ParamSpec } | undefined {
    const circuit = this.circuits.get(circuitName);
    if (!circuit) return undefined;
    const idx = this.paramIndex(circuit);
    const entry = idx.get(pname);
    if (entry) return entry;
    const m = pname.match(/^([a-zA-Z]+)(\d+)$/);
    if (m) {
      const base = idx.get(m[1]);
      if (base && base.spec.array && Number(m[2]) <= base.spec.array) {
        return base;
      }
    }
    return undefined;
  }

  /** Role (input/output) of a parameter; undefined if it does not exist. */
  paramRole(circuitName: string, pname: string): ParamRole | undefined {
    return this.paramLookup(circuitName, pname)?.role;
  }

  /**
   * Valid registers given a chain of declared controllers (in order). Combines
   * the master registers with the ones each controller contributes.
   */
  validRegisters(chain: string[]): Map<string, RegisterInfo> {
    const out = new Map<string, RegisterInfo>(this.masterRegs);
    chain.forEach((ctype, idx) => {
      const spec = this.controllers.get(ctype);
      if (!spec) return;
      const n = idx + 1; // controller number (1-based)
      for (const el of spec.elements) {
        const range = el.count
          ? rangeArray(1, el.count)
          : rangeArray(el.index!.min, el.index!.max);
        for (const y of range) {
          out.set(`${el.register}${n}.${y}`, {
            direction: el.direction,
            description: el.description,
            valuetype: el.valuetype,
          });
        }
      }
    });
    return out;
  }

  /** Information about a concrete register, or undefined if it does not exist. */
  registerInfo(name: string, chain: string[]): RegisterInfo | undefined {
    return this.validRegisters(chain).get(name);
  }

  /**
   * Chain of declared controllers (in order) in a patch. VSCode-free version so
   * it can be reused from the linter, the CLI and the labels module.
   */
  controllerChain(lines: string[]): string[] {
    const chain: string[] = [];
    let declaring = true;
    for (const raw of lines) {
      const code = raw.split("#")[0].trim();
      if (!code) continue;
      const hm = code.match(/^\[([a-z0-9]+)\]$/);
      if (hm && this.controllers.has(hm[1]) && declaring) {
        chain.push(hm[1]);
        continue;
      }
      declaring = false;
    }
    return chain;
  }
}

function expandMaster(
  regs: { masters: Record<string, { registers: RegisterFamily[] }> },
  master: string
): Map<string, RegisterInfo> {
  const out = new Map<string, RegisterInfo>();
  for (const fam of regs.masters[master].registers) {
    const info: RegisterInfo = {
      direction: fam.direction,
      description: fam.description,
      valuetype: fam.valuetype,
      requires: fam.requires ?? null,
    };
    if (fam.shape === "indexed" || fam.shape === "single") {
      for (const n of rangeArray(fam.index!.min, fam.index!.max)) {
        out.set(`${fam.prefix}${n}`, info);
      }
    } else if (fam.shape === "dotted") {
      for (const a of rangeArray(fam.group!.min, fam.group!.max)) {
        for (const b of rangeArray(fam.element!.min, fam.element!.max)) {
          out.set(`${fam.prefix}${a}.${b}`, info);
        }
      }
    }
  }
  return out;
}

function rangeArray(min: number, max: number): number[] {
  const r: number[] = [];
  for (let i = min; i <= max; i++) r.push(i);
  return r;
}
