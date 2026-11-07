// Generates src/generated/patch.json from the extension's own compiled core
// (../out, built with `npm run compile` at the repository root): the demo
// patches, the real lint messages, hover texts, completion lists, cable colours
// and the expanded duet.ini. The video shows these texts verbatim, so nothing on
// screen is invented. The JSON is committed, so rendering does not need ../out.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cableColor } from "../src/highlight.ts";
import { caretOf, completeDoc, completeStates, errorStates } from "../src/stories.ts";

const here = dirname(fileURLToPath(import.meta.url));
const video = resolve(here, "..");
const repo = resolve(video, "..");
const require = createRequire(import.meta.url);

// cables.js imports `vscode` for its decorator; the colour function does not use it.
const load = (Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = (req: string, ...rest: unknown[]) =>
  req === "vscode" ? {} : load(req, ...rest);

const { DroidData } = require(join(repo, "out/data.js"));
const { lint } = require(join(repo, "out/linter.js"));
const { parseBlueprint } = require(join(repo, "out/blueprints.js"));
const { buildPatch } = require(join(repo, "out/build.js"));
const { colorForCable } = require(join(repo, "out/cables.js"));

const data = DroidData.load([repo]);
const read = (p: string) => readFileSync(join(repo, p), "utf8").replace(/\r\n/g, "\n");
const melody = read("examples/melody.ini");
const duet = read("video/examples/duet.droider");
const pluckText = read("video/examples/blueprints/pluck.blueprint");
const pluck = parseBlueprint(pluckText, "pluck");
const blueprints = new Map([["pluck", pluck]]);

// ── The typo of the story: O3 becomes O9 on the envelope's output. ──
const typoLine = melody.split("\n").findIndex((l) => /^\s+output\s+=\s+O3$/.test(l));
if (typoLine < 0) throw new Error("melody.ini: contour output = O3 not found");
const melodyO9 = melody
  .split("\n")
  .map((l, i) => (i === typoLine ? l.replace("O3", "O9") : l))
  .join("\n");

const build = buildPatch(duet, data, "droider", blueprints);
if (build.problems.length) throw new Error("duet.droider does not build: " + JSON.stringify(build.problems));

const lints = {
  melody: lint(melody, data, { mode: "ini" }),
  melodyO9: lint(melodyO9, data, { mode: "ini" }),
  duet: lint(duet, data, { mode: "droider", blueprints }),
  pluck: lint(pluckText, data, { mode: "blueprint", blueprints }),
  duetIni: lint(build.ini, data, { mode: "ini" }),
};
for (const [name, problems] of Object.entries(lints))
  if (name !== "melodyO9" && problems.length) throw new Error(`${name} has problems: ${JSON.stringify(problems)}`);
if (lints.melodyO9.length !== 1) throw new Error("expected exactly one error for O9: " + JSON.stringify(lints.melodyO9));

// ── Parameter roles of the circuits on screen (same lookup as semantic.ts). ──
const shown = ["lfo", "euklid", "random", "minifonion", "contour", "copy"];
const roles: Record<string, Record<string, "input" | "output">> = {};
type Spec = { name: string; abbr?: string | null; valuetype?: string; default?: unknown; min?: number; max?: number; unit?: string; array?: number; description: string };
for (const name of shown) {
  const circuit = data.circuits.get(name);
  roles[name] = {};
  for (const [role, list] of [["input", circuit.inputs], ["output", circuit.outputs]] as const)
    for (const p of (list ?? []) as Spec[]) {
      roles[name][p.name] = role;
      for (let i = 1; i <= (p.array ?? 0); i++) roles[name][p.name + i] = role;
    }
}

// ── Hover texts: the same markdown hover.ts builds. ──
function paramHover(circuit: string, param: string) {
  const found = data.paramLookup(circuit, param);
  const spec = found.spec as Spec;
  let md = `**${spec.name}** · _${found.role}_`;
  if (spec.abbr) md += ` · abbr \`${spec.abbr}\``;
  if (spec.valuetype) md += ` · \`${spec.valuetype}\``;
  md += "\n\n";
  const facts: string[] = [];
  if (spec.default !== undefined) facts.push(`default: \`${spec.default}\``);
  if (spec.min !== undefined && spec.max !== undefined) facts.push(`range: \`${spec.min}…${spec.max}\``);
  if (spec.unit) facts.push(`unit: ${spec.unit}`);
  if (facts.length) md += facts.join(" · ") + "\n\n";
  return md + spec.description;
}
function circuitHover(name: string) {
  const c = data.circuits.get(name);
  return `**${c.name}** — ${c.title}\n\n${c.description}`;
}
function blueprintHover() {
  const fmt = (p: { name: string; default?: string }) => (p.default !== undefined ? `${p.name} (=${p.default})` : p.name);
  return (
    `**[${pluck.name}]** — megacircuit (blueprint)\n\n${pluck.doc}\n\n` +
    `**inputs:** ${pluck.inputs.map(fmt).join(", ")}\n\n**outputs:** ${pluck.outputs.map((p: { name: string }) => p.name).join(", ")}`
  );
}

// ── Completion lists: the items completion.ts offers (VS Code sorts by label). ──
type Kind = "class" | "module" | "field" | "property" | "variable" | "constant";
interface Item {
  label: string;
  kind: Kind;
  detail: string;
}
const byLabel = (a: Item, b: Item) => a.label.localeCompare(b.label);
const headerItems: Item[] = [
  ...[...data.circuits.values()].map((c: { name: string; title: string }) => ({ label: c.name, kind: "class" as const, detail: c.title })),
  ...[...data.controllers.values()].map((c: { type: string; title: string }) => ({ label: c.type, kind: "module" as const, detail: `Controller · ${c.title}` })),
].sort(byLabel);

function paramItems(circuitName: string, used: string[]): Item[] {
  const circuit = data.circuits.get(circuitName);
  const items: Item[] = [];
  for (const [role, list] of [["input", circuit.inputs], ["output", circuit.outputs]] as const)
    for (const p of (list ?? []) as Spec[]) {
      const abbr = p.abbr ? ` · abbr: ${p.abbr}` : "";
      const def = p.default !== undefined ? ` · def: ${p.default}` : "";
      const detail = `${role}${p.valuetype ? " " + p.valuetype : ""}${abbr}${def}`;
      const labels = p.array ? [p.name, ...Array.from({ length: p.array }, (_, i) => p.name + (i + 1))] : [p.name];
      for (const label of labels) if (!used.includes(label)) items.push({ label, kind: role === "input" ? "field" : "property", detail });
    }
  return items.sort(byLabel);
}

const chain = data.controllerChain(melody.split("\n"));
const registerItems: Item[] = [...data.validRegisters(chain)]
  .map(([name, info]: [string, { direction: string; valuetype?: string }]) => ({
    label: name,
    kind: "constant" as const,
    detail: `register · ${info.direction}${info.valuetype ? " · " + info.valuetype : ""}`,
  }))
  .sort(byLabel);

// While writing [contour], the document holds the cables written so far.
const cables = [...new Set(melody.split("\n").flatMap((l) => l.split("#")[0].match(/_[A-Za-z0-9_]+/g) ?? []))].sort();
const cableItems: Item[] = cables.map((c) => ({ label: c, kind: "variable", detail: "internal cable" }));

// ── Rainbow cables: check the video's copy of the hash against the extension's. ──
const allCables = new Set<string>();
for (const text of [melody, duet, pluckText, build.ini]) for (const m of text.match(/_[A-Za-z0-9_]+/g) ?? []) allCables.add(m);
const cableColors: Record<string, string> = {};
for (const c of allCables) {
  cableColors[c] = colorForCable(c);
  if (cableColor(c) !== cableColors[c]) throw new Error(`cable colour mismatch for ${c}`);
}

// ── Every state typed on screen, linted ──
const lintStates = {
  complete: completeStates.map((s) => lint(completeDoc(melody, caretOf(s.block).text), data, { mode: "ini" })),
  errors: errorStates.map((s) =>
    lint(melody.split("\n").map((l, i) => (i === typoLine ? l.replace("O3", s.value) : l)).join("\n"), data, { mode: "ini" }),
  ),
};
if (lintStates.complete[lintStates.complete.length - 1].length) throw new Error("the written [contour] block has problems");

// The messages on screen must still exist in the extension's source.
const source = read("src/droidCard.ts") + read("src/extension.ts");
for (const text of ["Writing to ${cardName}...", "Syncing...", "Ejecting...", "Patch written and verified on ${cardName}; card ejected safely. ", "Insert it into DROID and press Load (or return the X7 USB switch to center).", "$(cloud-upload) Write to DROID", "showInformationMessage(`Built ${rel}`)"])
  if (!source.includes(text)) throw new Error(`message changed in the extension: ${text}`);

const out = {
  docs: { melody, melodyO9, duet, pluck: pluckText, duetIni: build.ini },
  typoLine,
  roles,
  circuits: [...data.circuits.keys()].sort(),
  controllers: [...data.controllers.keys()].sort(),
  blueprint: {
    name: pluck.name,
    inputs: pluck.inputs.map((p: { name: string }) => p.name),
    outputs: pluck.outputs.map((p: { name: string }) => p.name),
  },
  lint: lints,
  lintStates,
  hover: {
    beats: paramHover("euklid", "beats"),
    minifonion: circuitHover("minifonion"),
    pluck: blueprintHover(),
  },
  completions: {
    header: headerItems,
    contour: paramItems("contour", []),
    contour1: paramItems("contour", ["trigger"]),
    contour4: paramItems("contour", ["trigger", "attack", "decay", "sustain"]),
    cables: cableItems,
    registers: registerItems,
  },
  cableColors,
  // The messages droidCard.ts and extension.ts show (the card is named DROID).
  messages: {
    built: "Built dist/duet.ini",
    writing: "Writing to DROID...",
    syncing: "Syncing...",
    ejecting: "Ejecting...",
    written:
      "✅ Patch written and verified on DROID; card ejected safely. Insert it into DROID and press Load (or return the X7 USB switch to center).",
    writeButton: "Write to DROID",
  },
};
mkdirSync(join(video, "src", "generated"), { recursive: true });
writeFileSync(join(video, "src", "generated", "patch.json"), JSON.stringify(out, null, 1));
console.log(
  `patch.json: ${Object.keys(out.docs).length} docs, ${headerItems.length} header items, ${registerItems.length} registers, ` +
    `${allCables.size} cables; O9 → "${lints.melodyO9[0].message}"`,
);
