import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { DroidData } from "../src/data";

const moduleLoader = require("node:module");
const originalLoad = moduleLoader._load;
let graphModule: typeof import("../src/circuitGraph");
try {
  moduleLoader._load = function (id: string, ...args: unknown[]) {
    return id === "vscode" ? {} : originalLoad.call(this, id, ...args);
  };
  graphModule = require("../src/circuitGraph");
} finally {
  moduleLoader._load = originalLoad;
}

const data = DroidData.load([process.cwd(), __dirname]);
const expressions = {
  attack: "_ENV_SCALE * _ENV_LENGTH * _D_A_RATIO * 20",
  decay: "_ENV_SCALE * P3.1 * ((1 - _V2DUR) + _V2DUR) * _VELOCITY",
  sustain: "1 - P3.2",
  release: "_ENV_SCALE * _ENV_LENGTH * (1 - _D_A_RATIO)",
  level: "P4.1 * I2",
};

function contourGraph() {
  const cables = new Set(Object.values(expressions).join(" ").match(/_[A-Z0-9_]+/g));
  const source = [
    ...Array(4).fill("[p2b8]"),
    ...[...cables].flatMap((cable) => ["[copy]", "input = I1", `output = ${cable}`]),
    "[contour]",
    ...Object.entries(expressions).map(([name, value]) => `${name} = ${value}`),
    "trigger = I1",
    "shape = 0.5",
  ].join("\n");
  return new graphModule.CircuitGraphBuilder(data).build(source);
}

test("every arithmetic operand keeps its own wire and ordered formula row", () => {
  const graph = contourGraph();
  const contour = graph.nodes.find((n) => n.name === "contour")!;
  for (const pin of contour.inputs!) {
    if (pin.name === "trigger" || pin.name === "shape") {
      assert.ok(!pin.rows[0].formula, "a simple connection keeps its ordinary pin");
      continue;
    }
    assert.ok(pin.rows.every((r) => r.formula), `${pin.name}: mixed formula and border pins`);
  }
  for (const [signal, pin] of [
    ["_ENV_SCALE", "i:attack:0"], ["_ENV_LENGTH", "i:attack:1"],
    ["_D_A_RATIO", "i:attack:2"], ["_V2DUR", "i:decay:3"],
    ["_V2DUR", "i:decay:4"],
    ["P3.1", "i:decay:1"], ["P3.2", "i:sustain:1"],
    ["P4.1", "i:level:0"], ["I2", "i:level:1"],
  ]) {
    assert.ok(graph.edges.some((e) => e.label === signal && e.toPin === pin));
  }
});

// Run the real webview renderer with a small DOM and deterministic text widths.
// This checks the visible order in SVG, rather than only the graph metadata.
class Element {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  style = {};
  textContent = "";
  checked = true;
  clientWidth = 1000;
  clientHeight = 1000;
  constructor(readonly tag: string) {}
  get firstChild() { return this.children[0]; }
  appendChild(child: Element) { this.children.push(child); }
  removeChild(child: Element) { this.children.splice(this.children.indexOf(child), 1); }
  setAttribute(key: string, value: unknown) { this.attrs[key] = String(value); }
  addEventListener() {}
}

function renderContour(): Element {
  const contour = contourGraph().nodes.find((n) => n.name === "contour")!;
  const renderHTML = graphModule.CircuitGraphProvider.prototype as unknown as {
    generateHTML(graph: unknown, uri: string): string;
  };
  const html = renderHTML.generateHTML({ nodes: [contour], edges: [] }, "");
  const elements = new Map<string, Element>();
  const getElementById = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id)!;
  };
  const context = createContext({
    window: {},
    document: {
      getElementById,
      createElementNS: (_ns: string, tag: string) => new Element(tag),
      createElement: () => ({ getContext: () => ({ measureText: (s: string) => ({ width: s.length * 6 }) }) }),
    },
    acquireVsCodeApi: () => ({ setState() {} }),
    setTimeout() {},
  });
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    runInContext(script[1], context);
  }
  return getElementById("viewport").children[1].children[0];
}

function readRows(node: Element): string[] {
  const rows = new Map<number, { x: number; text: string }[]>();
  for (const element of node.children) {
    if (element.tag !== "circle" && element.tag !== "text") continue;
    if (element.attrs.class === "header-text") continue;
    const y = Number(element.attrs.cy ?? element.attrs.y);
    const x = Number(element.attrs.cx ?? element.attrs.x);
    const text = element.tag === "circle" ? "●" : element.textContent;
    if (!text) continue;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push({ x, text });
  }
  return [...rows].sort(([a], [b]) => a - b).map(([, parts]) =>
    parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(" ")
  );
}

test("SVG formulas read left to right across rows, with operators before signal dots", () => {
  assert.deepEqual(readRows(renderContour()), [
    "attack = ●", "× ●", "× ●", "× 20",
    "decay = ●", "× ●", "× (( 1", "− ● )", "+ ● )", "× ●",
    "sustain = 1", "− ●",
    "release = ●", "× ●", "× ( 1", "− ● )",
    "level = ●", "× ●",
    "● trigger", // a single signal retains its border pin and label
    "shape 0.5", // a single constant retains its label and chip
  ]);
});

test("formula continuations align at the left margin and fit inside the card", () => {
  const node = renderContour();
  const body = node.children.find((e) => e.attrs.class === "node-body")!;
  const left = Number(body.attrs.x);
  const right = left + Number(body.attrs.width);
  const heads = node.children.filter((e) => e.tag === "text" && / =$/.test(e.textContent));
  assert.equal(heads.length, Object.keys(expressions).length);
  for (const head of heads) {
    const y = Number(head.attrs.y);
    const first = node.children.find((e) =>
      Number(e.attrs.cy ?? e.attrs.y) === y && (e.tag === "circle" || e.attrs.class === "chip-text")
    )!;
    assert.ok(Number(first.attrs.cx ?? first.attrs.x) > Number(head.attrs.x) + head.textContent.length * 6);
    const nextOp = node.children.find((e) => e.attrs.class === "pin-name pin-op" && Number(e.attrs.y) > y)!;
    assert.equal(Number(nextOp.attrs.x), Number(head.attrs.x));
  }
  const operators = node.children.filter((e) => e.attrs.class === "pin-name pin-op");
  for (const operator of operators) {
    assert.equal(Number(operator.attrs.x), Number(heads[0].attrs.x));
  }
  for (const element of node.children) {
    if (element.tag === "circle") {
      const cx = Number(element.attrs.cx), radius = Number(element.attrs.r);
      assert.ok(cx >= left && cx + radius < right);
    } else if (element.tag === "rect" && element.attrs.class !== "node-body") {
      assert.ok(Number(element.attrs.x) >= left);
      assert.ok(Number(element.attrs.x) + Number(element.attrs.width) < right);
    }
  }
});
