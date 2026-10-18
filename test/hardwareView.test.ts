import { test } from "node:test";
import assert from "node:assert/strict";
import { DroidData } from "../src/data";

const loader = require("node:module");
const originalLoad = loader._load;
let Parser: typeof import("../src/hardwareView").PatchParser;
let View: typeof import("../src/hardwareView").HardwareViewProvider;
try {
  loader._load = function (id: string, ...args: unknown[]) {
    return id === "vscode" ? {} : originalLoad.call(this, id, ...args);
  };
  ({ PatchParser: Parser, HardwareViewProvider: View } = require("../src/hardwareView"));
} finally {
  loader._load = originalLoad;
}

test("hardware view follows Forge order and renders the G1 label and description on the first G8", () => {
  const text = [
    "# LABELS: master=16", "# GATES ON MODULE 1:", "#  G1: [TRIG] Envelope trigger",
    "[s10]", "[p10]", "[p2b8]",
    "[copy]", "input = G1", "output = G2.1",
    "[copy]", "input = G1", "output = G9",
  ].join("\n");
  const hardware = new Parser(DroidData.load([process.cwd(), __dirname])).parse(text);
  assert.deepEqual(hardware.controllers.map((c) => [c.type, c.number]), [["s10", 1], ["p10", 2], ["p2b8", 3]]);
  assert.equal(hardware.g8[0].jacks[0].label?.short, "TRIG");
  const view = Object.create(View.prototype) as { generateHTML: (...args: unknown[]) => string };
  const html = view.generateHTML(hardware.controllers, hardware.master, hardware.masterLabels, hardware.g8, hardware.x7, "file:///test.ini");
  const titles = [...html.matchAll(/<div class="(?:controller|master)-title">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["DROID", "G8", "G8", "X7", "S10", "P10", "P2B8"]);
  assert.match(html, /class="master-io-label">TRIG<\/div>/);
  assert.match(html, /G1\.1 – Envelope trigger/);
});
