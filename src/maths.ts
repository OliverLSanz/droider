// Arbitrary math expressions: the second piece of `.droider` syntactic sugar.
//
// DROID itself only evaluates a *very* restricted form on each circuit input:
// `A * B + C` (one multiplication, one addition; see §6 of `docs/reference.md`).
// In a `.droider` file we let the author write arbitrary arithmetic instead —
// for now `+`, `-`, `*` and parentheses — and rewrite it into the minimum number
// of `copy` circuits, each whose `input` is a valid native `A * B + C` slot, so
// the result runs unchanged on the hardware.
//
//   level = (_A + _B) * _C      # in a .droider file
//
// becomes (one auto-generated cable + one copy):
//
//   [copy]
//       input = _A + _B
//       output = _MATH1
//   [copy]
//       input = _MATH1 * _C     # the consuming circuit keeps the final slot
//       ...
//
// Auto-generated cables are named `_MATH<n>` so they are easy to tell apart from
// hand-written cables and never collide with them.
//
// This module is pure (no VSCode), so it is reused by the linter, the CLI, the
// `.droider`→`.ini` expansion and the circuit graph view.

import type { Problem } from "./linter";
import { firmwareLineLength, splitComment } from "./patchText";

// --- AST -------------------------------------------------------------------

/** A leaf: a number (`0.5`, `10V`), a register (`P1.1`) or a cable (`_FOO`). */
export interface AtomNode {
  t: "atom";
  text: string;
}
/** Unary minus. */
export interface NegNode {
  t: "neg";
  e: Node;
}
/** A flattened chain of `+`/`-` terms (`a - b + c`). The first sign is `+1`. */
export interface AddNode {
  t: "add";
  terms: { sign: 1 | -1; e: Node }[];
}
/** A flattened chain of `*` factors (`a * b * c`). */
export interface MulNode {
  t: "mul";
  factors: Node[];
}

export type Node = AtomNode | NegNode | AddNode | MulNode;

// --- Lexer -----------------------------------------------------------------

type Tok =
  | { k: "num"; text: string }
  | { k: "id"; text: string }
  | { k: "op"; text: "+" | "-" | "*" }
  | { k: "lparen" }
  | { k: "rparen" };

const ATOM_HEAD = /[A-Za-z_]/;
const ATOM_BODY = /[A-Za-z0-9_.]/;
const NUM_BODY = /[0-9.]/;

function lex(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*") {
      toks.push({ k: "op", text: c });
      i++;
      continue;
    }
    if (c === "(") {
      toks.push({ k: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ k: "rparen" });
      i++;
      continue;
    }
    if (NUM_BODY.test(c)) {
      let j = i;
      while (j < s.length && NUM_BODY.test(s[j])) j++;
      if (j < s.length && (s[j] === "V" || s[j] === "%")) j++;
      toks.push({ k: "num", text: s.slice(i, j) });
      i = j;
      continue;
    }
    if (ATOM_HEAD.test(c)) {
      let j = i;
      while (j < s.length && ATOM_BODY.test(s[j])) j++;
      // A trailing unit on an identifier-looking constant (rare) is left as-is.
      toks.push({ k: "id", text: s.slice(i, j) });
      i = j;
      continue;
    }
    // Anything else (`/`, `%`, `^`, `,`, …) is outside the supported grammar.
    throw new Error(`unexpected character '${c}'`);
  }
  return toks;
}

// --- Parser ----------------------------------------------------------------

class Parser {
  private toks: Tok[];
  private pos = 0;
  constructor(s: string) {
    this.toks = lex(s);
  }
  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  atEnd(): boolean {
    return this.pos >= this.toks.length;
  }
  // expr := term (('+'|'-') term)*
  parseExpr(): Node {
    const terms: AddNode["terms"] = [{ sign: 1, e: this.parseTerm() }];
    for (;;) {
      const t = this.peek();
      if (t && t.k === "op" && (t.text === "+" || t.text === "-")) {
        this.pos++;
        terms.push({ sign: t.text === "+" ? 1 : -1, e: this.parseTerm() });
      } else break;
    }
    return terms.length === 1 ? terms[0].e : { t: "add", terms };
  }
  // term := unary ('*' unary)*
  private parseTerm(): Node {
    const factors: Node[] = [this.parseUnary()];
    for (;;) {
      const t = this.peek();
      if (t && t.k === "op" && t.text === "*") {
        this.pos++;
        factors.push(this.parseUnary());
      } else break;
    }
    return factors.length === 1 ? factors[0] : { t: "mul", factors };
  }
  // unary := '-' unary | primary   (a unary '+' is not meaningful and rejected)
  private parseUnary(): Node {
    const t = this.peek();
    if (t && t.k === "op" && t.text === "-") {
      this.pos++;
      return { t: "neg", e: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  // primary := '(' expr ')' | atom
  private parsePrimary(): Node {
    const t = this.peek();
    if (!t) throw new Error("unexpected end of expression");
    if (t.k === "lparen") {
      this.pos++;
      const e = this.parseExpr();
      const close = this.peek();
      if (!close || close.k !== "rparen") throw new Error("missing ')'");
      this.pos++;
      return e;
    }
    if (t.k === "num" || t.k === "id") {
      this.pos++;
      return { t: "atom", text: t.text };
    }
    throw new Error(`unexpected token '${"text" in t ? t.text : t.k}'`);
  }
}

/** Parses an expression, returning the AST or `null` if it is not parseable
 * with the supported grammar (`+ - * ( )`). Text literals are not expressions. */
export function parseExpression(value: string): Node | null {
  const v = value.trim();
  if (v === "" || v.startsWith('"')) return null;
  try {
    const p = new Parser(v);
    const n = p.parseExpr();
    if (!p.atEnd()) return null;
    return n;
  } catch {
    return null;
  }
}

// --- Native-slot validation ------------------------------------------------

function isNumericAtom(text: string): boolean {
  return /^-?\d[\d.]*[V%]?$/.test(text) || text === "on" || text === "off";
}

/** A single operand `A`/`B`/`C`: a bare atom, or `-constant` (a negative
 * number is still a constant, but `-register` spends the one multiplication). */
function atomLike(n: Node): boolean {
  return n.t === "atom" || (n.t === "neg" && n.e.t === "atom" && isNumericAtom(n.e.text));
}

/** A single native multiplication `A * B` of two operands. */
function mulLike(n: Node): boolean {
  return n.t === "mul" && n.factors.length <= 2 && n.factors.every(atomLike);
}

/** True if `n` already fits DROID's native `A * B + C` input slot and so needs
 * no decomposition (the multiplication, if any, must come before the offset). */
function astIsNative(n: Node): boolean {
  switch (n.t) {
    case "atom":
      return true;
    case "neg":
      // `-X` is the negation shorthand `-1 * X`; only valid for a bare atom.
      return n.e.t === "atom";
    case "mul":
      return mulLike(n);
    case "add": {
      if (n.terms.length === 1) return astIsNative(n.terms[0].e);
      if (n.terms.length > 2) return false;
      const [t0, t1] = n.terms;
      const hasMul = mulLike(t0.e);
      const leadOk = atomLike(t0.e) || hasMul;
      // The offset must be a single operand.
      const offOk = atomLike(t1.e);
      if (!leadOk || !offOk) return false;
      // With a leading multiplication, the offset must be a constant: subtracting
      // (or adding a negated) register/cable would spend a second multiplication.
      if (hasMul && t1.sign < 0 && t1.e.t === "atom" && !isNumericAtom(t1.e.text)) {
        return false;
      }
      return true;
    }
  }
}

/** True if `value` is a valid native DROID input (`A * B + C` or simpler). A
 * value the grammar cannot parse (e.g. division `/`) is conservatively treated
 * as native so callers do not flag forms DROID itself accepts. */
export function isNativeSlot(value: string): boolean {
  const ast = parseExpression(value);
  if (!ast) return true;
  return astIsNative(ast);
}

/** Returns an error message if `value` is a malformed math expression
 * (consecutive operators, a dangling operator, adjacent operands, empty or
 * unbalanced parentheses…), otherwise `null`. Values that the lexer cannot
 * tokenize (text literals, native division `I1 / 12`, etc.) are not our grammar
 * and are left alone — they are validated elsewhere. */
export function expressionError(value: string): string | null {
  const v = value.trim();
  if (v === "" || v.startsWith('"')) return null;
  let toks: Tok[];
  try {
    toks = lex(v);
  } catch {
    return null; // contains '/', '%', or other chars outside this grammar
  }

  // Walk the token stream: each operand must be separated from the next by a
  // single binary operator; a single leading '-' (negation) is the only unary.
  let depth = 0;
  let expectOperand = true; // at start, after '(' or after a binary operator
  for (const t of toks) {
    if (t.k === "lparen") {
      if (!expectOperand) return "missing operator before '('";
      depth++;
    } else if (t.k === "rparen") {
      if (expectOperand) return "unexpected ')' (an operand was expected)";
      if (--depth < 0) return "unbalanced parentheses: unexpected ')'";
      expectOperand = false;
    } else if (t.k === "op") {
      if (expectOperand) {
        if (t.text !== "-") return `unexpected '${t.text}' (an operand was expected)`;
        // a unary minus: an operand is still expected next
      } else {
        expectOperand = true; // binary operator
      }
    } else {
      // an operand (number / register / cable)
      if (!expectOperand) return "two operands with no operator between them";
      expectOperand = false;
    }
  }
  if (depth > 0) return "unbalanced parentheses: missing ')'";
  if (expectOperand) return "expression ends with an operator";
  return null;
}

/** True if `value` uses math sugar that `.ini` cannot express directly: it has
 * parentheses, or it parses to something beyond a native `A * B + C` slot. */
export function isComplexExpression(value: string): boolean {
  if (value.includes("(")) return true;
  const ast = parseExpression(value);
  if (!ast) return false;
  return !astIsNative(ast);
}

// --- Decomposition ---------------------------------------------------------

export interface GeneratedCopy {
  input: string;
  output: string;
}

interface Ctx {
  fresh: () => string;
  copies: GeneratedCopy[];
}

/** True for a string that is a single pure operand (number/register/cable),
 * safe to use as a multiplicand. A leading `-` is only pure on a number. */
function isPureAtom(s: string): boolean {
  const t = s.trim();
  return /^-?\d[\d.]*[V%]?$/.test(t) || /^_?[A-Za-z][A-Za-z0-9_.]*$/.test(t);
}

/** Joins an offset onto a left expression, turning `+ -N` into `- N`. */
function joinAdd(left: string, right: string): string {
  const r = right.trim();
  if (r.startsWith("-")) return `${left} - ${r.slice(1)}`;
  return `${left} + ${r}`;
}

/** Emits a `copy` computing `inputSlot` into a fresh cable, returns the cable. */
function emit(ctx: Ctx, inputSlot: string): string {
  const cable = ctx.fresh();
  ctx.copies.push({ input: inputSlot, output: cable });
  return cable;
}

function negateAtom(a: string): string {
  return a.startsWith("-") ? a.slice(1) : `-${a}`;
}

/** Reduces a node to a single pure atom, emitting copies for everything else. */
function reduce(ctx: Ctx, n: Node): string {
  if (n.t === "atom") return n.text;
  const slot = reduceSlot(ctx, n);
  return isPureAtom(slot) ? slot : emit(ctx, slot);
}

/** Reduces a `mul` (or atom) into at most a two-atom product `{ a, b? }`,
 * leaving the final multiplication uncommitted so a caller can place it in a
 * slot. Extra factors are folded into copies. */
function mulForm(ctx: Ctx, n: Node): { a: string; b?: string } {
  if (n.t !== "mul") return { a: reduce(ctx, n) };
  const atoms = n.factors.map((f) => reduce(ctx, f));
  if (atoms.length === 1) return { a: atoms[0] };
  let acc = atoms[0];
  for (let i = 1; i < atoms.length - 1; i++) acc = emit(ctx, `${acc} * ${atoms[i]}`);
  return { a: acc, b: atoms[atoms.length - 1] };
}

function mulString(m: { a: string; b?: string }): string {
  return m.b === undefined ? m.a : `${m.a} * ${m.b}`;
}

/** Folds a list of signed terms into a single pure atom (their signed sum),
 * fusing each positive product into the `A * B + C` slot of its copy. */
function foldTermsToAtom(ctx: Ctx, terms: AddNode["terms"]): string {
  const others = terms.filter((t) => !(t.sign > 0 && t.e.t === "mul"));
  const products = terms.filter((t) => t.sign > 0 && t.e.t === "mul");
  let acc: string | null = null;
  for (const t of others) {
    if (acc === null) {
      acc = t.sign > 0 ? reduce(ctx, t.e) : reduce(ctx, { t: "neg", e: t.e });
    } else if (t.sign > 0) {
      acc = emit(ctx, joinAdd(acc, reduce(ctx, t.e)));
    } else {
      acc = emit(ctx, `${acc} - ${reduce(ctx, t.e)}`);
    }
  }
  for (const t of products) {
    const lead = mulString(mulForm(ctx, t.e));
    acc = acc === null ? emit(ctx, lead) : emit(ctx, joinAdd(lead, acc));
  }
  return acc!;
}

/** Builds a native slot string for an `add` node, using the slot's single
 * `A * B + C` capacity and emitting copies for the rest. */
function addSlot(ctx: Ctx, terms: AddNode["terms"]): string {
  if (terms.length === 1) {
    const t = terms[0];
    return t.sign > 0 ? reduceSlot(ctx, t.e) : negateAtom(reduce(ctx, t.e));
  }
  // Prefer a positive product as the leading `A * B` (DROID needs mult first).
  const mi = terms.findIndex((t) => t.sign > 0 && t.e.t === "mul");
  if (mi >= 0) {
    const lead = mulString(mulForm(ctx, terms[mi].e));
    const rest = terms.filter((_, k) => k !== mi);
    if (rest.length === 0) return lead;
    return joinAdd(lead, foldTermsToAtom(ctx, rest));
  }
  // No multiplication to lead with: fold everything but the last term, inline it.
  const head = terms.slice(0, terms.length - 1);
  const last = terms[terms.length - 1];
  const acc = foldTermsToAtom(ctx, head);
  const a = reduce(ctx, last.e);
  return last.sign > 0 ? joinAdd(acc, a) : `${acc} - ${a}`;
}

/** Reduces a node to a valid native slot string, emitting copies as needed. */
function reduceSlot(ctx: Ctx, n: Node): string {
  switch (n.t) {
    case "atom":
      return n.text;
    case "neg":
      return negateAtom(reduce(ctx, n.e));
    case "mul":
      return mulString(mulForm(ctx, n));
    case "add":
      return addSlot(ctx, n.terms);
  }
}

export interface DecomposeResult {
  /** The final native slot expression to put back in the parameter value. */
  expr: string;
  /** Auto-generated `copy` circuits that must precede the consumer. */
  copies: GeneratedCopy[];
}

/** Decomposes one input `value` into a native slot plus the copy circuits
 * needed to compute it. Returns `null` if `value` is not a parseable
 * expression (text literal, division, etc.), in which case it is left as-is. */
export function decomposeValue(value: string, fresh: () => string): DecomposeResult | null {
  const ast = parseExpression(value);
  if (!ast) return null;
  // Already a valid native slot: keep it verbatim, never spend a copy on it.
  if (astIsNative(ast)) return { expr: value.trim(), copies: [] };
  const ctx: Ctx = { fresh, copies: [] };
  const expr = reduceSlot(ctx, ast);
  return { expr, copies: ctx.copies };
}

/** Materializes long operands so even a native slot fits the line buffer.
 * Cable names are shortened first by the card-formatting pass. Long numeric
 * operands can still require copies; their spelling and precision are kept. */
export function fitSlotLength(value: string, budget: number, fresh: () => string): DecomposeResult {
  const ctx: Ctx = { fresh, copies: [] };
  let expr = value;
  while (firmwareLineLength(expr) > budget) {
    const ast = parseExpression(expr);
    if (!ast) break; // Text and unsupported syntax are validated separately.
    const atoms: AtomNode[] = [];
    const visit = (node: Node) => {
      if (node.t === "atom") atoms.push(node);
      else if (node.t === "neg") visit(node.e);
      else if (node.t === "mul") node.factors.forEach(visit);
      else node.terms.forEach((term) => visit(term.e));
    };
    visit(ast);
    // A copy's input has 57 characters available (63 minus "input=").
    // An indivisible atom longer than that cannot be represented by a copy.
    const atom = atoms.filter((a) => a.text.length <= 57)
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (!atom) break;
    const cable = fresh();
    if (atom.text.length <= cable.length) break;
    ctx.copies.push({ input: atom.text, output: cable });
    atom.text = cable;
    expr = reduceSlot(ctx, ast);
  }

  const copies: GeneratedCopy[] = [];
  for (const copy of ctx.copies) {
    const fitted = fitSlotLength(copy.input, 57, fresh);
    copies.push(...fitted.copies, { input: fitted.expr, output: copy.output });
  }
  return { expr, copies };
}

// --- Operand extraction (for the graph view) -------------------------------

/** Lists the operand texts (numbers, registers, cables) of an expression in
 * left-to-right order. Falls back to a token scan if the value cannot be
 * parsed, so the graph can still draw wires for unusual values. */
export function extractOperands(value: string): string[] {
  const ast = parseExpression(value);
  const out: string[] = [];
  if (ast) {
    const walk = (n: Node) => {
      switch (n.t) {
        case "atom":
          out.push(n.text);
          break;
        case "neg":
          walk(n.e);
          break;
        case "mul":
          n.factors.forEach(walk);
          break;
        case "add":
          n.terms.forEach((t) => walk(t.e));
          break;
      }
    };
    walk(ast);
    return out;
  }
  for (const m of value.matchAll(/_?[A-Za-z][A-Za-z0-9_.]*|\d[\d.]*[V%]?/g)) {
    out.push(m[0]);
  }
  return out;
}

/** One operand of an expression, ready to render as its own graph row. */
export interface RowToken {
  /** Binary operator preceding this operand (`""` for the first one). */
  op: "" | "+" | "-" | "*";
  /** Bare operand including a unary sign, for classification (e.g. `-_X`). */
  bare: string;
  /** Number of parentheses opening immediately before this operand. */
  open: number;
  /** Number of parentheses closing immediately after this operand. */
  close: number;
}

/** Flattens an expression into one token per operand, keeping the preceding
 * operator and the parentheses that open before / close after each operand
 * (as separate counts, so they can be drawn outside the operand) — so a
 * parenthesized formula can be shown as independent rows instead of a single
 * combined row. Returns `[]` if the value is not parseable. */
export function tokenizeForRows(value: string): RowToken[] {
  let toks: Tok[];
  try {
    toks = lex(value.trim());
  } catch {
    return [];
  }
  const out: RowToken[] = [];
  let pendingOp: RowToken["op"] = "";
  let expectOperand = true; // at start, after '(' or after a binary operator
  let sign = "";
  let open = 0;
  let lastIdx = -1;
  for (const t of toks) {
    if (t.k === "lparen") {
      open++;
      expectOperand = true;
      continue;
    }
    if (t.k === "rparen") {
      if (lastIdx >= 0) out[lastIdx].close++;
      continue;
    }
    if (t.k === "op") {
      if (expectOperand) sign += t.text; // unary sign on the next operand
      else {
        pendingOp = t.text;
        expectOperand = true;
      }
      continue;
    }
    // num or id: an operand.
    out.push({ op: pendingOp, bare: sign + t.text, open, close: 0 });
    lastIdx = out.length - 1;
    pendingOp = "";
    sign = "";
    open = 0;
    expectOperand = false;
  }
  return out;
}

// --- Text-level expansion pass ---------------------------------------------

const HEADER_RE = /^\s*\[([a-z0-9]+)\]\s*$/;

/**
 * Rewrites every complex math expression in an `.ini`-shaped text into the
 * minimum number of `copy` circuits, so that every resulting input is a valid
 * native `A * B + C` slot. Runs after blueprint expansion. The auto-generated
 * copies for a circuit are emitted immediately before that circuit's header.
 */
export function expandMathExpressions(text: string): { ini: string; problems: Problem[] } {
  const lines = text.split(/\r?\n/);
  const problems: Problem[] = [];

  // Fresh `_MATH<n>` cables, skipping any name already present in the text.
  const used = new Set<string>();
  for (const m of text.matchAll(/_MATH\d+/g)) used.add(m[0]);
  let counter = 0;
  const fresh = () => {
    let name: string;
    do {
      counter++;
      name = `_MATH${counter}`;
    } while (used.has(name));
    used.add(name);
    return name;
  };

  // Surface malformed expressions (e.g. an unclosed parenthesis) instead of
  // passing them through unchanged into an invalid `.ini`.
  lines.forEach((raw, i) => {
    const [code] = splitComment(raw);
    if (HEADER_RE.test(code)) return;
    const eq = code.indexOf("=");
    if (eq < 0) return;
    const value = code.slice(eq + 1).trim();
    const err = expressionError(value);
    if (err) {
      const col = code.indexOf(value, eq + 1);
      problems.push({
        line: i,
        startCol: col < 0 ? eq + 1 : col,
        endCol: code.length,
        message: err,
        severity: "error",
      });
    }
  });

  const out: string[] = [];
  let block: string[] = [];

  const flush = () => {
    if (block.length === 0) return;
    const genCopies: string[] = [];
    const processed = block.map((line) => {
      const [code, comment] = splitComment(line);
      if (HEADER_RE.test(code)) return line;
      const eq = code.indexOf("=");
      if (eq < 0) return line;
      const lhs = code.slice(0, eq);
      const value = code.slice(eq + 1).trim();
      if (!value) return line;
      const res = decomposeValue(value, fresh);
      if (!res) return line;
      if (res.copies.length === 0 && res.expr === value) return line;
      for (const c of res.copies) {
        genCopies.push("[copy]", `    input = ${c.input}`, `    output = ${c.output}`);
      }
      return `${lhs}= ${res.expr}` + (comment ? "  " + comment : "");
    });
    out.push(...genCopies, ...processed);
    block = [];
  };

  for (const line of lines) {
    const [code] = splitComment(line);
    if (HEADER_RE.test(code)) flush();
    block.push(line);
  }
  flush();

  return { ini: out.join("\n"), problems };
}
