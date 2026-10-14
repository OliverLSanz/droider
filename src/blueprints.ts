// Blueprints ("megacircuits"): the first piece of `.droider` syntactic sugar.
//
// A `.blueprint` file defines a reusable sub-patch with a public interface of
// named input/output ports. Inside, it wires standard DROID circuits together,
// referring to the ports by name (and using private `_cables` for everything it
// wants to hide). The megacircuit name comes from the file name
// (`mix2.blueprint` -> `mix2`).
//
//   # Sums two signals and attenuates the result by "level".   <- megacircuit doc
//
//   [input]
//       # the first signal              <- port doc (from the comment above it)
//       a
//       # the second signal
//       b
//       # attenuation, full level if omitted
//       level = 1                       <- "= value" gives a default (optional input)
//
//   [output]
//       out
//
//   [copy]                              <- body: standard circuits + private cables
//       input  = a + b
//       output = _MIX                   <- _MIX is private: hidden from outside
//
//   [copy]
//       input  = _MIX * level
//       output = out
//
// In a `.droider` file the megacircuit is used like any circuit:
//
//   [mix2]
//       a     = I1
//       b     = I2
//       out   = O1                      <- "level" may be omitted (it has a default)
//
// `expandToIni` rewrites that into plain `.ini` circuits: port references are
// replaced by whatever the caller wired (or the default), and private cables are
// renamed to a unique `__<name>_<n>_<CABLE>` so two instances never collide.
//
// This module is pure (no VSCode), so it is reused by the linter, the CLI and
// the editor expansion command.

import type { Problem } from "./linter";
import { expandMathExpressions } from "./maths";

export interface BlueprintPort {
  /** Public port name, referred to directly inside the blueprint body. */
  name: string;
  /** Default value for an input port (makes it optional); undefined otherwise. */
  default?: string;
  /** Documentation from the comment line(s) directly above the port. */
  doc?: string;
  /** Line where the port is declared (0-based). */
  line: number;
}

export interface Blueprint {
  /** Megacircuit name (from the file name). */
  name: string;
  /** Documentation from the comment block at the top of the file. */
  doc?: string;
  inputs: BlueprintPort[];
  outputs: BlueprintPort[];
  /** Body lines (standard circuits + private cables), comments preserved. */
  body: string[];
}

const HEADER_RE = /^\[([a-z0-9]+)\]$/;
const PORT_ENTRY_RE = /^([A-Za-z][A-Za-z0-9_]*)\s*(?:=\s*(.+))?$/;
// Value tokens that may need rewriting: private cables and bare identifiers.
const VALUE_TOKEN_RE = /_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9.]*/g;

/** True for a header line `[name]`; returns the inner name or null. */
function headerName(rawCode: string): string | null {
  const m = rawCode.trim().match(HEADER_RE);
  return m ? m[1] : null;
}

/** Splits a line into [code, comment] keeping the `#`. */
function splitComment(raw: string): [string, string] {
  const i = raw.indexOf("#");
  return i >= 0 ? [raw.slice(0, i), raw.slice(i)] : [raw, ""];
}

/** Text of a line's comment (after `#`, trimmed), or null if there is none. */
function commentText(raw: string): string | null {
  const i = raw.indexOf("#");
  return i >= 0 ? raw.slice(i + 1).trim() : null;
}

/**
 * Parses a `.blueprint` file into its doc, port interface and body. `name` is
 * the megacircuit name (caller passes the file base name). Best-effort:
 * malformed lines are ignored here; the linter reports them with positions.
 */
export function parseBlueprint(text: string, name: string): Blueprint {
  const lines = text.split(/\r?\n/);
  const inputs: BlueprintPort[] = [];
  const outputs: BlueprintPort[] = [];
  const body: string[] = [];
  const topDoc: string[] = [];

  type Section = "none" | "input" | "output";
  let section: Section = "none";
  let seenHeader = false;
  let bodyStarted = false;
  let pendingDoc: string[] = []; // comment lines awaiting the next port

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const [code] = splitComment(raw);
    const trimmed = code.trim();
    const hn = headerName(code);

    if (hn === "input" || hn === "output") {
      section = hn;
      seenHeader = true;
      pendingDoc = [];
      continue;
    }
    if (hn) {
      // A standard circuit (or nested megacircuit) header: body starts.
      section = "none";
      seenHeader = true;
      bodyStarted = true;
      pendingDoc = [];
      body.push(raw);
      continue;
    }

    // Top-of-file comment block -> megacircuit documentation.
    if (!seenHeader) {
      const c = commentText(raw);
      if (c !== null) topDoc.push(c);
      continue;
    }

    if (section === "input" || section === "output") {
      if (trimmed === "") {
        const c = commentText(raw);
        if (c !== null) pendingDoc.push(c); // comment line: accumulate as doc
        else pendingDoc = []; // blank line: detach pending doc
        continue;
      }
      const m = trimmed.match(PORT_ENTRY_RE);
      if (m) {
        const port: BlueprintPort = {
          name: m[1],
          default: section === "input" ? m[2]?.trim() : undefined,
          doc: pendingDoc.length ? pendingDoc.join(" ") : undefined,
          line: i,
        };
        (section === "input" ? inputs : outputs).push(port);
      }
      pendingDoc = [];
      continue;
    }

    if (bodyStarted) body.push(raw);
  }

  return {
    name,
    doc: topDoc.length ? topDoc.join("\n") : undefined,
    inputs,
    outputs,
    body,
  };
}

/** A caller value is "compound" if it combines operands with operators. */
function isCompound(value: string): boolean {
  const t = value.trim();
  if (t.startsWith('"')) return false; // text literal
  const bodyPart = t.replace(/^[-+]/, ""); // a single leading sign is fine
  return /[+\-*/]/.test(bodyPart);
}

/** Rewrites only the value side (right of the first `=`) of a body line. */
function rewriteBodyLine(raw: string, mapToken: (t: string) => string): string {
  const [code, comment] = splitComment(raw);
  const eq = code.indexOf("=");
  if (eq < 0) return raw; // header, blank or comment-only line
  const lhs = code.slice(0, eq + 1);
  const rhs = code.slice(eq + 1).replace(VALUE_TOKEN_RE, mapToken);
  return lhs + rhs + comment;
}

interface ExpandCtx {
  blueprints: Map<string, Blueprint>;
  counters: Map<string, number>;
  problems: Problem[];
}

export interface ExpandResult {
  ini: string;
  problems: Problem[];
}

/**
 * Expands every megacircuit instance in a `.droider` text into plain DROID
 * circuits, returning the resulting `.ini` text. Nested blueprints expand
 * recursively; cycles are reported and broken.
 */
export function expandToIni(
  text: string,
  blueprints: Map<string, Blueprint>
): ExpandResult {
  const ctx: ExpandCtx = { blueprints, counters: new Map(), problems: [] };
  const lines = text.split(/\r?\n/);
  const out = expandLines(lines, [], ctx);
  // Second sugar pass: rewrite arbitrary math expressions (in the original
  // patch and any introduced by blueprint inlining) into native `copy` circuits.
  const math = expandMathExpressions(out.join("\n"));
  return { ini: math.ini, problems: [...ctx.problems, ...math.problems] };
}

/** Expands blueprint instances found in `lines`; non-instances pass through. */
function expandLines(lines: string[], stack: string[], ctx: ExpandCtx): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const [code] = splitComment(raw);
    const hn = headerName(code);

    if (hn && ctx.blueprints.has(hn)) {
      const params = new Map<string, string>();
      let j = i + 1;
      for (; j < lines.length; j++) {
        const [pcode] = splitComment(lines[j]);
        if (headerName(pcode)) break;
        const eq = pcode.indexOf("=");
        if (eq < 0) continue;
        const key = pcode.slice(0, eq).trim();
        const val = pcode.slice(eq + 1).trim();
        if (key) params.set(key, val);
      }
      out.push(...expandInstance(hn, params, stack, ctx));
      i = j;
    } else {
      out.push(raw);
      i++;
    }
  }
  return out;
}

/** Expands a single blueprint instance into circuit lines. */
function expandInstance(
  name: string,
  params: Map<string, string>,
  stack: string[],
  ctx: ExpandCtx
): string[] {
  const bp = ctx.blueprints.get(name)!;

  if (stack.includes(name)) {
    ctx.problems.push({
      line: 0,
      startCol: 0,
      endCol: 0,
      message: `blueprint cycle detected: ${[...stack, name].join(" -> ")}`,
      severity: "error",
    });
    return [`# (cycle: ${[...stack, name].join(" -> ")} not expanded)`];
  }

  const n = (ctx.counters.get(name) ?? 0) + 1;
  ctx.counters.set(name, n);

  const renamePrivate = (cable: string) => `__${name}_${n}_${cable.slice(1)}`;
  const renamePort = (port: string) => `__${name}_${n}_${port}`;

  // Map each port name to the value the caller wired (or its default), and
  // materialize compound input expressions into their own copy circuit so that
  // substitution can never break DROID's left-to-right evaluation.
  const subst = new Map<string, string>();
  const preCopies: string[] = [];

  for (const port of bp.outputs) {
    const v = params.get(port.name);
    if (v !== undefined) subst.set(port.name, v);
  }
  for (const port of bp.inputs) {
    const v = params.get(port.name) ?? port.default;
    if (v === undefined) continue; // missing required input: linter reports it
    if (isCompound(v)) {
      preCopies.push("[copy]", `    input = ${v}`, `    output = ${renamePort(port.name)}`);
      subst.set(port.name, renamePort(port.name));
    } else {
      subst.set(port.name, v);
    }
  }

  const mapToken = (tok: string): string => {
    if (tok.startsWith("_")) return renamePrivate(tok);
    const direct = subst.get(tok);
    return direct !== undefined ? direct : tok;
  };

  const substituted = bp.body.map((raw) => rewriteBodyLine(raw, mapToken));
  const expandedBody = expandLines(substituted, [...stack, name], ctx);

  return [
    `# --- begin ${name} #${n} ---`,
    ...preCopies,
    ...expandedBody,
    `# --- end ${name} #${n} ---`,
  ];
}

/**
 * Detects whether expanding `name` would recurse into itself (directly or
 * transitively). Used by the linter to flag cyclic blueprint references.
 */
export function blueprintCycle(
  name: string,
  blueprints: Map<string, Blueprint>,
  stack: string[] = []
): boolean {
  if (stack.includes(name)) return true;
  const bp = blueprints.get(name);
  if (!bp) return false;
  for (const raw of bp.body) {
    const [code] = splitComment(raw);
    const hn = headerName(code);
    if (hn && blueprints.has(hn)) {
      if (blueprintCycle(hn, blueprints, [...stack, name])) return true;
    }
  }
  return false;
}
