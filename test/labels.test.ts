import { test } from "node:test";
import assert from "node:assert/strict";
import { DroidData } from "../src/data";
import { labelSectionAtLine, lintLabels, parseLabelLegend } from "../src/labels";

const data = DroidData.load([process.cwd(), __dirname]);

test("Forge gate sections accept G8 and X7 labels without inheriting the previous section", () => {
  const text = [
    "# LABELS: master=16",
    "# OUTPUTS:", "#  O1: [ENV] Envelope output",
    "# GATES ON MODULE 1:", "#  G1: [TRIG] Envelope trigger",
    "# GATES ON MODULE 2:", "#  G2.3: [CLK] Clock input",
    "# GATES ON X7:", "#  G9: [RUN] Run output",
    "# CONTROLLER 1:", "#  B1.1: [TAP] Tap button", "[p2b8]",
  ].join("\n");
  assert.deepEqual(lintLabels(text, data), []);
  const labels = parseLabelLegend(text);
  assert.deepEqual(labels.get("G1"), { label: "TRIG", description: "Envelope trigger" });
  assert.deepEqual([...labels.keys()], ["O1", "G1", "G2.3", "G9", "B1.1"]);
  assert.deepEqual(labelSectionAtLine(text.split("\n"), 4), { kind: "gates", gateModule: 1 });
  assert.deepEqual(labelSectionAtLine(text.split("\n"), 8), { kind: "gates" });
  assert.deepEqual(labelSectionAtLine(text.split("\n"), 10), { kind: "controller", controller: 1 });
});

test("gate labels still warn when a register belongs to a different module", () => {
  const text = [
    "# LABELS: master=16", "# GATES ON MODULE 1:", "#  G2.1: [CLK] Wrong G8",
    "# GATES ON X7:", "#  G1: [TRIG] Wrong expander",
  ].join("\n");
  const warnings = lintLabels(text, data);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((p) => p.severity === "warning"));
  assert.match(warnings[0].message, /does not belong to GATES ON MODULE 1/);
  assert.match(warnings[1].message, /does not belong to GATES ON X7/);
});
