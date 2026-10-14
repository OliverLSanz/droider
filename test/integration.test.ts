import { test } from "node:test";
import assert from "node:assert/strict";
import { expandToIni, parseBlueprint, Blueprint } from "../src/blueprints";
import { lint } from "../src/linter";
import { DroidData } from "../src/data";

const data = DroidData.load([process.cwd(), __dirname]);

// --- expandToIni: math expressions end to end -------------------------------

test("expandToIni decomposes a complex input into native copies", () => {
  const src = ["[copy]", "    input = (_A + _B) * _C", "    output = O1"].join("\n");
  const { ini, problems } = expandToIni(src, new Map());
  assert.deepEqual(problems, []);
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

test("expandToIni leaves native A*B+C inputs untouched", () => {
  const src = ["[copy]", "    input = I1 * 0.5 + I2", "    output = O1"].join("\n");
  const { ini } = expandToIni(src, new Map());
  assert.equal(ini, src);
});

// --- expandToIni: blueprint + math combined ---------------------------------

test("expandToIni expands a blueprint whose caller passes a complex expression", () => {
  const bpText = [
    "[input]",
    "    a",
    "[output]",
    "    out",
    "[copy]",
    "    input = a",
    "    output = out",
  ].join("\n");
  const bps = new Map<string, Blueprint>([["passthru", parseBlueprint(bpText, "passthru")]]);

  const src = ["[passthru]", "    a = (_X + _Y) * _Z", "    out = O1"].join("\n");
  const { ini } = expandToIni(src, bps);

  // The blueprint materializes the compound input into a copy, then the math
  // pass decomposes it further into native slots.
  assert.ok(ini.includes("input = _X + _Y"), `missing inner add copy:\n${ini}`);
  assert.ok(/output = O1/.test(ini), `missing output wiring:\n${ini}`);
  // Every generated copy input must be a single native operation.
  for (const m of ini.matchAll(/input = (.+)/g)) {
    const v = m[1].trim();
    const ops = (v.match(/[*]/g) || []).length;
    const adds = (v.match(/(?<=\S\s)[+\-]/g) || []).length;
    assert.ok(ops <= 1 && adds <= 1, `non-native generated input "${v}"`);
  }
});

// --- linter: sugar allowed in .droider, rejected in .ini --------------------

const complexPatch = ["[copy]", "    input = (I1 + I2) * 0.5", "    output = O1"].join("\n");

test("linter flags complex math in .ini mode", () => {
  const problems = lint(complexPatch, data, { mode: "ini" });
  assert.ok(
    problems.some((p) => /native A \* B \+ C/.test(p.message)),
    `expected a native-slot error, got: ${JSON.stringify(problems)}`
  );
});

test("linter allows complex math in .droider mode", () => {
  const problems = lint(complexPatch, data, { mode: "droider" });
  assert.ok(
    !problems.some((p) => /native A \* B \+ C/.test(p.message)),
    `unexpected native-slot error: ${JSON.stringify(problems)}`
  );
});

test("linter rejects output arithmetic in both source and generated patches", () => {
  const source = "[copy]\n    input = I1\n    output = O1 * 0.5";
  const { ini, problems } = expandToIni(source, new Map());
  assert.deepEqual(problems, []);
  for (const [text, mode] of [[source, "droider"], [ini, "ini"]] as const) {
    assert.ok(lint(text, data, { mode }).some((p) => /output.*single destination/.test(p.message)));
  }
});

test("linter validates operands inside parenthesized expressions", () => {
  // `_FOO` has no producer -> still detected as a cable consumer (no false
  // 'unknown register' from the surrounding parentheses).
  const patch = ["[copy]", "    input = (I1 + I2) * I3", "    output = O1"].join("\n");
  const problems = lint(patch, data, { mode: "droider" });
  assert.ok(
    !problems.some((p) => /unknown register: \(/.test(p.message)),
    `parenthesis leaked into a token: ${JSON.stringify(problems)}`
  );
});
