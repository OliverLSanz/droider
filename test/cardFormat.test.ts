import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPatch } from "../src/build";
import { DroidData } from "../src/data";
import { splitComment, firmwareLineLength } from "../src/patchText";

const data = DroidData.load([process.cwd(), __dirname]);

function build(source: string): string {
  const { ini, problems } = buildPatch(source, data, "droider");
  assert.deepEqual(problems, []);
  for (const line of ini.split("\n")) {
    assert.ok(firmwareLineLength(splitComment(line)[0]) <= 63, line);
  }
  return ini;
}

test("the reported velocity expression compiles with consistent short cable aliases", () => {
  const source = [
    "[copy]", "input = I1", "output = _ENV1_VELOCITY_RANDOM_POT",
    "[copy]", "input = I2", "output = _ENV1_VELOCITY_RANDOM_POT_ATTENUATION",
    "[copy]", "input = _ENV1_VELOCITY_RANDOM_POT * _ENV1_VELOCITY_RANDOM_POT_ATTENUATION",
    "output = O1",
  ].join("\n");
  const ini = build(source);
  assert.ok(ini.includes("output = _C1"));
  assert.ok(ini.includes("input = _ENV1_VELOCITY_RANDOM_POT * _C1"));
  assert.ok(ini.includes("# _C1 = _ENV1_VELOCITY_RANDOM_POT_ATTENUATION"));
});

test("aliases cannot collide with existing cable names, including firmware case folding", () => {
  const name = `_LONG_${"A".repeat(60)}`;
  const ini = build([
    "[copy]", "input = I1", "output = _c1",
    "[copy]", "input = _c1", `output = ${name}`,
    "[copy]", `input = ${name}`, "output = O1",
  ].join("\n"));
  assert.ok(ini.includes(`output = _C2`));
  assert.ok(ini.includes("input = _c1"));
});

test("rewriting preserves comments and quoted text, even when they mention renamed cables", () => {
  const name = `_LONG_${"A".repeat(60)}`;
  const ini = build([
    "# " + name,
    "[copy]", "input = I1", `output = ${name} # ${name}`,
    "[copy]", `input = ${name}`, "output = O1",
    "[copy]", 'input = "# _LONG"', "output = O2",
  ].join("\n"));
  assert.ok(ini.includes(`output = _C1 # ${name}`));
  assert.ok(ini.includes('input = "# _LONG"'));
  assert.ok(ini.startsWith(`# ${name}\n`));
});

test("long numeric arithmetic is split into copies without rounding constants", () => {
  const a = `0.${"123456789".repeat(4)}`;
  const b = `0.${"987654321".repeat(4)}`;
  const ini = build(`[copy]\ninput = ${a} * ${b} + I1\noutput = O1`);
  assert.ok(ini.includes(`input = ${a}`));
  assert.ok(ini.includes(b));
  assert.ok(ini.indexOf(`input = ${a}`) < ini.indexOf(`* ${b}`));
});

test("short source retains its formatting and names", () => {
  const source = "[copy]\n    input = I1\n    output = _ENV\n[copy]\n    input = _ENV * 0.5\n    output = O1\n";
  assert.equal(build(source), source);
});
