import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPatch, describeBuildProblem } from "../src/build";
import { parseBlueprint } from "../src/blueprints";
import { DroidData } from "../src/data";

const data = DroidData.load([process.cwd(), __dirname]);

test("blueprint cable expansion respects the hardware limit by shortening generated names", () => {
  const name = "envelopevelocityrandomizer";
  const blueprint = parseBlueprint([
    "[input]", "signal", "[output]", "out",
    "[copy]", "input = signal", "output = _A",
    "[copy]", "input = signal", "output = _B",
    "[copy]", "input = _A * _B", "output = out",
  ].join("\n"), name);
  const source = `[${name}]\nsignal = I1\nout = O1`;
  const result = buildPatch(source, data, "droider", new Map([[name, blueprint]]));
  assert.deepEqual(result.problems, []);
  assert.ok(result.ini.includes("# Compiler cable aliases:"));
  assert.ok(result.ini.includes("# _C1 = __envelopevelocityrandomizer_1_A"));
});

test("source validation cannot be bypassed by blueprint expansion", () => {
  const name = "passthru";
  const blueprint = parseBlueprint("[input]\nsignal\n[output]\nout\n[copy]\ninput = signal\noutput = out", name);
  const result = buildPatch(`[${name}]\nsignal = I1\nout = O1\nunknown = I2`, data,
    "droider", new Map([[name, blueprint]]));
  assert.ok(result.problems.some((p) => p.location === "source" && /unknown port/.test(p.message)));
});

test("plain .ini uploads reject invalid destinations and oversized lines", () => {
  const invalidOutput = buildPatch("[copy]\ninput = I1\noutput = 01", data, "ini");
  assert.ok(invalidOutput.problems.some((p) => /single destination/.test(p.message)));
  const longInput = buildPatch(`[copy]\ninput=0.${"1".repeat(56)}\noutput=O1`, data, "ini");
  assert.ok(longInput.problems.some((p) => /line too long/.test(p.message)));
});

test("complex source lines may exceed 63 characters when all generated lines fit", () => {
  const source = `[copy]\ninput = ${Array(25).fill("I1").join(" * ")}\noutput = O1`;
  const result = buildPatch(source, data, "droider");
  assert.deepEqual(result.problems, []);
  assert.ok(result.ini.includes("_MATH"));
});

test("an indivisible text value reports its generated location when it cannot fit", () => {
  const result = buildPatch(`[copy]\ninput = "${"x".repeat(60)}"\noutput = O1`, data, "droider");
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].location, "generated");
  assert.match(describeBuildProblem(result.problems[0]), /generated .ini line 2/);
});
