import { test } from "node:test";
import assert from "node:assert/strict";
import { DroidData } from "../src/data";
import { lint, PatchMode } from "../src/linter";
import { parseBlueprint } from "../src/blueprints";

const data = DroidData.load([process.cwd(), __dirname]);
const modes: PatchMode[] = ["ini", "droider", "blueprint"];
const destinationError = /output.*single destination/i;

test("outputs reject expressions and literal values in every patch mode", () => {
  for (const mode of modes) {
    for (const value of [
      "O1 * 0.5", "O1 + O2", "O1 - 1", "O1 / 2", "-O1", "(O1)",
      "(O1 + O2) * O3", "O1 +", "O1 O2", "0.5", "10V", "50%",
      "on", "off", '"O1"',
    ]) {
      const line = `    output = ${value}`;
      const problems = lint(`[copy]\n    input = I1\n${line}`, data, { mode });
      const problem = problems.find((p) => destinationError.test(p.message));
      assert.ok(problem, `${mode}: accepted output = ${value}`);
      assert.equal(problem.severity, "error");
      assert.equal(problem.line, 2);
      assert.equal(problem.startCol, line.indexOf("=") + (value ? 2 : 1));
      assert.equal(problem.endCol, line.length);
      assert.equal(problems.length, 1, `${mode}: redundant errors for ${value}`);
    }
  }
});

test("output validation also covers abbreviations and numbered arrays", () => {
  for (const mode of modes) {
    for (const [circuit, param] of [
      ["copy", "o"], ["adc", "bit"], ["adc", "bit2"], ["adc", "b2"],
      ["contour", "inverted"], ["contour", "iv"],
    ]) {
      const problems = lint(`[${circuit}]\n${param} = O1 * 0.5`, data, { mode });
      assert.ok(problems.some((p) => destinationError.test(p.message)), `${circuit}.${param} (${mode})`);
    }
  }
});

test("single output destinations and input arithmetic remain valid", () => {
  for (const mode of modes) {
    for (const destination of ["O1", "N1", "R1", "L1.1"]) {
      const patch = `[p2b8]\n[copy]\ninput = I1 * 0.5 + I2\noutput = ${destination} # destination`;
      assert.deepEqual(lint(patch, data, { mode }), [], `${mode}: ${destination}`);
    }
    const cablePatch = "[copy]\ninput = I1\noutput = _ENV\n[copy]\ninput = _ENV * 0.5\noutput = O1";
    assert.deepEqual(lint(cablePatch, data, { mode }), []);
  }
  const complexInput = "[copy]\ninput = (I1 + I2) * I3\noutput = O1";
  assert.deepEqual(lint(complexInput, data, { mode: "droider" }), []);
  assert.deepEqual(lint(complexInput, data, { mode: "blueprint" }), []);
  assert.ok(lint(complexInput, data).some((p) => /native A \* B \+ C/.test(p.message)));
});

test("output destination checks preserve unknown-register and direction diagnostics", () => {
  for (const [destination, message] of [
    ["O9", /unknown register: O9/],
    ["I1", /input-only register 'I1' used as an output/],
  ] as const) {
    const problems = lint(`[copy]\ninput = I2\noutput = ${destination}`, data);
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, message);
  }
});

test("invalid output expressions do not count their operands as cable producers", () => {
  const patch = "[copy]\ninput = I1\noutput = _ENV * 0.5\n[copy]\ninput = _ENV\noutput = O1";
  const problems = lint(patch, data, { mode: "droider" });
  assert.ok(problems.some((p) => destinationError.test(p.message)));
  assert.ok(problems.some((p) => /'_ENV' has no output/.test(p.message)));
});

test("blueprint output ports accept a destination and reject arithmetic", () => {
  const definition = "[input]\nsource\n[output]\nresult\n[copy]\ninput = source\noutput = result";
  const blueprints = new Map([["passthru", parseBlueprint(definition, "passthru")]]);
  assert.deepEqual(lint(definition, data, { mode: "blueprint" }), []);
  const invalidBody = definition.replace("output = result", "output = result * 0.5");
  assert.ok(lint(invalidBody, data, { mode: "blueprint" }).some((p) => destinationError.test(p.message)));

  for (const mode of ["droider", "blueprint"] as const) {
    const patch = "[passthru]\nsource = I1 * 0.5\nresult = O1";
    assert.deepEqual(lint(patch, data, { mode, blueprints }), []);
    const invalid = patch.replace("result = O1", "result = O1 * 0.5");
    assert.ok(lint(invalid, data, { mode, blueprints }).some((p) => destinationError.test(p.message)));
  }
});
