import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decomposeValue,
  expandMathExpressions,
  isNativeSlot,
  isComplexExpression,
  extractOperands,
  tokenizeForRows,
  expressionError,
  GeneratedCopy,
} from "../src/maths";

// A deterministic fresh-cable generator for tests: _MATH1, _MATH2, ...
function freshGen(): () => string {
  let n = 0;
  return () => `_MATH${++n}`;
}

// --- Independent arithmetic oracle -----------------------------------------
// Evaluates an expression string with `+ - * ( )` against a variable scope,
// using the JS engine itself (a parser independent of the one under test).
function jsEval(expr: string, scope: Record<string, number>): number {
  const js = expr.replace(/_?[A-Za-z][A-Za-z0-9_]*/g, (t) => {
    if (!(t in scope)) throw new Error(`unknown operand '${t}' in '${expr}'`);
    return `(${scope[t]})`;
  });
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${js});`)();
}

// Evaluate the result of a decomposition: run the generated copies in order to
// populate cable values, then evaluate the final slot expression.
function evalDecomposed(
  expr: string,
  copies: GeneratedCopy[],
  scope: Record<string, number>
): number {
  const env: Record<string, number> = { ...scope };
  for (const c of copies) {
    env[c.output] = jsEval(c.input, env);
  }
  return jsEval(expr, env);
}

// ===========================================================================
// Exact-output (snapshot) tests — pin the minimal decomposition.
// ===========================================================================

const cases: { value: string; expr: string; copies: GeneratedCopy[] }[] = [
  // Already native: left untouched, no copies.
  { value: "a", expr: "a", copies: [] },
  { value: "a + b", expr: "a + b", copies: [] },
  { value: "a - b", expr: "a - b", copies: [] },
  { value: "a * b", expr: "a * b", copies: [] },
  { value: "a * b + c", expr: "a * b + c", copies: [] },
  // `A * B - reg` is NOT native (the negation spends a second multiplication),
  // so it must be decomposed.
  {
    value: "a * b - c",
    expr: "a * b + _MATH1",
    copies: [{ input: "-c", output: "_MATH1" }],
  },
  // `A * B - constant` IS native (the constant is just a negative offset).
  { value: "a * b - 2", expr: "a * b - 2", copies: [] },

  // Reordering so the multiplication leads (DROID requires mult-before-offset).
  { value: "c + a * b", expr: "a * b + c", copies: [] },

  // One extra addition -> one copy.
  {
    value: "a + b + c",
    expr: "_MATH1 + c",
    copies: [{ input: "a + b", output: "_MATH1" }],
  },
  // One extra multiplication -> one copy.
  {
    value: "a * b * c",
    expr: "_MATH1 * c",
    copies: [{ input: "a * b", output: "_MATH1" }],
  },
  // Two products summed -> one copy (the second product fits an A*B+C copy... here a plain copy).
  {
    value: "a * b + c * d",
    expr: "a * b + _MATH1",
    copies: [{ input: "c * d", output: "_MATH1" }],
  },
  // Parentheses force a copy.
  {
    value: "(a + b) * c",
    expr: "_MATH1 * c",
    copies: [{ input: "a + b", output: "_MATH1" }],
  },
  {
    value: "(a + b) * (c + d)",
    expr: "_MATH1 * _MATH2",
    copies: [
      { input: "a + b", output: "_MATH1" },
      { input: "c + d", output: "_MATH2" },
    ],
  },
  // A product fused with its addition into a single A*B+C copy.
  {
    value: "a * b + c * d + e",
    expr: "a * b + _MATH1",
    copies: [{ input: "c * d + e", output: "_MATH1" }],
  },
];

for (const c of cases) {
  test(`decompose: "${c.value}"`, () => {
    const res = decomposeValue(c.value, freshGen());
    assert.ok(res, `expected "${c.value}" to be a parseable expression`);
    assert.equal(res!.expr, c.expr, `expr for "${c.value}"`);
    assert.deepEqual(res!.copies, c.copies, `copies for "${c.value}"`);
  });
}

// ===========================================================================
// Every generated slot must be a valid native DROID input.
// ===========================================================================

test("all generated slots are native A*B+C", () => {
  const samples = [
    "(a + b) * (c + d) * (e + f)",
    "a * b * c * d",
    "a + b + c + d + e",
    "((a + b) * c + d) * (e - f)",
    "a - b - c - d",
    "-a * b + c",
    "-(a + b)",
    "a * (b + c) - d * (e + f)",
    "2 * (a + 3) + b",
  ];
  for (const s of samples) {
    const res = decomposeValue(s, freshGen());
    assert.ok(res, `parseable: ${s}`);
    for (const cp of res!.copies) {
      assert.ok(isNativeSlot(cp.input), `copy input not native: "${cp.input}" (from ${s})`);
    }
    assert.ok(isNativeSlot(res!.expr), `final expr not native: "${res!.expr}" (from ${s})`);
  }
});

// ===========================================================================
// Fuzz test: random expressions must evaluate identically before/after.
// ===========================================================================

test("fuzz: decomposition preserves value and stays native", () => {
  const vars = ["a", "b", "c", "d", "e", "f"];
  let seed = 1234567;
  const rnd = () => {
    // xorshift for reproducibility
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const gen = (depth: number): string => {
    if (depth <= 0 || rnd() < 0.35) {
      return rnd() < 0.6 ? pick(vars) : String(Math.floor(rnd() * 9) + 1);
    }
    const r = rnd();
    if (r < 0.25) return `(${gen(depth - 1)})`;
    const op = pick(["+", "-", "*"]);
    return `${gen(depth - 1)} ${op} ${gen(depth - 1)}`;
  };

  for (let iter = 0; iter < 4000; iter++) {
    const expr = gen(3 + Math.floor(rnd() * 2));
    const res = decomposeValue(expr, freshGen());
    assert.ok(res, `should parse: ${expr}`);

    // Random integer assignment for the variables.
    const scope: Record<string, number> = {};
    for (const v of vars) scope[v] = Math.floor(rnd() * 11) - 5;

    const expected = jsEval(expr, scope);
    const actual = evalDecomposed(res!.expr, res!.copies, scope);
    assert.ok(
      Math.abs(expected - actual) < 1e-9,
      `value mismatch for "${expr}": expected ${expected}, got ${actual}\n  expr=${res!.expr}\n  copies=${JSON.stringify(res!.copies)}`
    );

    for (const cp of res!.copies) {
      assert.ok(isNativeSlot(cp.input), `non-native copy "${cp.input}" from "${expr}"`);
    }
    assert.ok(isNativeSlot(res!.expr), `non-native final "${res!.expr}" from "${expr}"`);
  }
});

// ===========================================================================
// isNativeSlot / isComplexExpression
// ===========================================================================

test("isNativeSlot accepts native forms", () => {
  for (const v of ["a", "P1.1", "_X", "10V", "a * b", "a * b + c", "a + b", "a - b", "-a", "I1 / 12"]) {
    assert.ok(isNativeSlot(v), `should be native: ${v}`);
  }
});

test("isNativeSlot rejects complex forms", () => {
  for (const v of ["a + b + c", "a * b * c", "(a + b) * c", "c + a * b", "a * b + c * d"]) {
    assert.ok(!isNativeSlot(v), `should NOT be native: ${v}`);
  }
});

test("expressionError flags malformed expressions", () => {
  const bad: [string, RegExp][] = [
    // Unbalanced / misplaced parentheses
    ["(_A + _B + _C", /missing '\)'/],
    ["((_A + _B)", /missing '\)'/],
    ["_A + _B)", /unexpected '\)'/],
    [")_A(", /unexpected '\)'/],
    ["(_A + ) * _B", /an operand was expected/],
    ["_A + ()", /an operand was expected/],
    ["(* _A)", /unexpected '\*'/],
    // Consecutive / dangling operators
    ["_A + + _B", /unexpected '\+'/],
    ["_A + * _B", /unexpected '\*'/],
    ["_A * * _B", /unexpected '\*'/], // e.g. a stray "**"
    ["+ _A", /unexpected '\+'/],
    ["* _A", /unexpected '\*'/],
    ["_A +", /ends with an operator/],
    ["_A * ", /ends with an operator/],
    ["_A + _B *", /ends with an operator/],
    ["+", /unexpected '\+'/],
    // Adjacent operands with no operator
    ["_A _B", /two operands/],
    ["_A (_B)", /missing operator before '\('/],
    ["(_A)(_B)", /missing operator before '\('/],
    ["2 _A", /two operands/],
  ];
  for (const [value, re] of bad) {
    const err = expressionError(value);
    assert.ok(err, `expected an error for "${value}"`);
    assert.match(err!, re, `wrong message for "${value}"`);
  }
});

test("expressionError accepts well-formed (and non-grammar) values", () => {
  const ok = [
    "(_A + _B) * _C",
    "_A + _B + _C",
    "_A * _B * _C",
    "_A * 0.5 + _B",
    "-_A",
    "-(_A + _B)",
    "_A + -_B", // a plus a negated b
    "_A - -_B",
    "((_A + _B) * _C) - _D",
    // Not this grammar -> left alone (validated elsewhere):
    "I1 / 12", // native division by a constant
    "(I1 + I2) / 2", // contains '/', bail out
    '"some text"',
    "0.5",
    "10V",
    "on",
    "P1.1",
    "", // empty value
  ];
  for (const value of ok) {
    assert.equal(expressionError(value), null, `should be accepted: "${value}"`);
  }
});

test("isComplexExpression", () => {
  assert.ok(isComplexExpression("(a + b) * c"));
  assert.ok(isComplexExpression("a + b + c"));
  assert.ok(!isComplexExpression("a * b + c"));
  assert.ok(!isComplexExpression("a"));
  assert.ok(!isComplexExpression('"text"'));
  assert.ok(!isComplexExpression("I1 / 12")); // native division, not flagged
});

// ===========================================================================
// extractOperands
// ===========================================================================

test("tokenizeForRows splits a formula into per-operand rows", () => {
  assert.deepEqual(tokenizeForRows("(I1 + I2) * _GAIN"), [
    { op: "", bare: "I1", open: 1, close: 0 },
    { op: "+", bare: "I2", open: 0, close: 1 },
    { op: "*", bare: "_GAIN", open: 0, close: 0 },
  ]);
  // Nested parens and a unary sign.
  assert.deepEqual(tokenizeForRows("-(_A + (_B * 2))"), [
    { op: "", bare: "-_A", open: 1, close: 0 },
    { op: "+", bare: "_B", open: 1, close: 0 },
    { op: "*", bare: "2", open: 0, close: 2 },
  ]);
  assert.deepEqual(tokenizeForRows("I1 / 12"), []); // unsupported -> no split
});

test("extractOperands lists operands in order", () => {
  assert.deepEqual(extractOperands("(_A + _B) * _C"), ["_A", "_B", "_C"]);
  assert.deepEqual(extractOperands("P1.1 * 0.5 + I1"), ["P1.1", "0.5", "I1"]);
  assert.deepEqual(extractOperands("-_X * 2"), ["_X", "2"]);
});

// ===========================================================================
// Text-level expansion (expandMathExpressions) — the .droider -> .ini pass.
// ===========================================================================

test("expandMathExpressions emits copies before the consuming circuit", () => {
  const input = ["[copy]", "    input = (_A + _B) * _C", "    output = O1"].join("\n");
  const { ini } = expandMathExpressions(input);
  assert.equal(
    ini,
    [
      "[copy]",
      "    input = _A + _B",
      "    output = _MATH1",
      "[copy]",
      "    input = _MATH1 * _C",
      "    output = O1",
    ].join("\n")
  );
});

test("expandMathExpressions leaves native inputs untouched", () => {
  const input = ["[lfo]", "    rate = P1.1 * 0.5 + 0.2", "    output = _LFO"].join("\n");
  const { ini } = expandMathExpressions(input);
  assert.equal(ini, input);
});

test("expandMathExpressions normalizes offset-before-mult to native order", () => {
  const input = ["[copy]", "    input = _OFF + _A * _B", "    output = O1"].join("\n");
  const { ini } = expandMathExpressions(input);
  assert.equal(
    ini,
    ["[copy]", "    input = _A * _B + _OFF", "    output = O1"].join("\n")
  );
});

test("expandMathExpressions avoids _MATH name collisions with existing cables", () => {
  const input = [
    "[copy]",
    "    input = _MATH1 + _Q",
    "    output = _MATH1",
    "[copy]",
    "    input = (_X + _Y) + _Z",
    "    output = O1",
  ].join("\n");
  const { ini } = expandMathExpressions(input);
  // The generated cable must not be _MATH1 (already used); expect _MATH2.
  assert.ok(ini.includes("output = _MATH2"), `output:\n${ini}`);
  assert.ok(!/output = _MATH1\n.*output = _MATH1/s.test(ini));
});

test("expandMathExpressions preserves comments on rewritten lines", () => {
  const input = ["[copy]", "    input = a + b + c   # mix three", "    output = O1"].join("\n");
  const { ini } = expandMathExpressions(input);
  assert.ok(ini.includes("# mix three"), `comment lost:\n${ini}`);
});
