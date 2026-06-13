// Circuit graph webview panel: shows every circuit declared in the patch as a
// node and draws the connections between them. Two circuits are connected when
// one writes an internal cable (_NAME) that the other reads, or when a circuit
// reads/writes a hardware register (I/O/P...). Nodes are laid out left-to-right
// following the signal flow (sources/inputs on the left, sinks/outputs on the
// right), rendered as SVG with no external dependencies.

import * as vscode from "vscode";
import { DroidData } from "./data";
import { colorForCable } from "./cables";

const HEADER_RE = /^\[([a-z0-9]+)\]$/;
// Identifier candidates on the value side. A cable starts with "_" and may
// contain interior underscores (_ENV1_ATTACK); a register/word does not
// (I1, O2, P3.1). The cable alternative comes first so it wins greedily.
const TOKEN_RE = /_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9]*(?:\.\d+)?/g;

interface CircuitInstance {
  index: number; // 1-based position among circuits in the patch
  name: string; // circuit type (e.g. "copy")
  known: boolean; // is it a documented circuit?
  headerLine: number; // line of the [header], for "reveal in editor"
  params: { param: string; value: string }[];
}

type NodeKind = "circuit" | "hwin" | "hwout";

interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  color: string;
  title: string;
  line?: number;
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
  color: string;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const HW_IN_COLOR = "#6ec06e";
const HW_OUT_COLOR = "#d98c6a";

/** Stable color for a circuit type name (distinct palette from cables). */
function colorForCircuit(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 45, 52);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = (x: number) =>
    Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Builds the circuit-connection graph for a patch. Pure logic (no VSCode), so
 * it can be unit-tested independently of the webview.
 */
export class CircuitGraphBuilder {
  constructor(private data: DroidData) {}

  build(text: string): Graph {
    const lines = text.split(/\r?\n/);
    const chain = this.data.controllerChain(lines);
    const validRegs = this.data.validRegisters(chain);
    const instances = this.parseCircuits(lines);

    const nodes: GraphNode[] = [];
    const nodeIds = new Set<string>();
    const addNode = (n: GraphNode) => {
      if (!nodeIds.has(n.id)) {
        nodeIds.add(n.id);
        nodes.push(n);
      }
    };

    // One node per circuit instance.
    for (const inst of instances) {
      const circuit = this.data.circuits.get(inst.name);
      addNode({
        id: "c" + inst.index,
        label: inst.name,
        kind: "circuit",
        color: colorForCircuit(inst.name),
        title: circuit ? circuit.title : "Unknown circuit",
        line: inst.headerLine,
      });
    }

    // Collect, per signal, which circuits produce it and which consume it.
    const cableProducers = new Map<string, string[]>();
    const cableConsumers = new Map<string, string[]>();
    const regUses: { reg: string; nodeId: string; dir: "in" | "out" }[] = [];

    for (const inst of instances) {
      const nid = "c" + inst.index;
      for (const p of inst.params) {
        const role = this.roleOf(inst, p.param);
        const { cables, regs } = this.extractSignals(p.value, validRegs);

        for (const cable of cables) {
          const map = role === "output" ? cableProducers : cableConsumers;
          push(map, cable, nid);
        }
        for (const reg of regs) {
          const info = validRegs.get(reg);
          const isOut =
            role === "output" ||
            (!role && info?.direction === "output");
          regUses.push({ reg, nodeId: nid, dir: isOut ? "out" : "in" });
        }
      }
    }

    const edges: GraphEdge[] = [];
    const seenEdge = new Set<string>();
    const addEdge = (e: GraphEdge) => {
      const key = e.from + "->" + e.to + "|" + e.label;
      if (!seenEdge.has(key)) {
        seenEdge.add(key);
        edges.push(e);
      }
    };

    // Cable edges: producer circuit -> each consumer circuit.
    for (const [cable, producers] of cableProducers) {
      const consumers = cableConsumers.get(cable) ?? [];
      for (const from of producers) {
        for (const to of consumers) {
          if (from !== to) {
            addEdge({ from, to, label: cable.slice(1), color: colorForCable(cable) });
          }
        }
      }
    }

    // Hardware-register edges, with one node per referenced register.
    for (const u of regUses) {
      const info = validRegs.get(u.reg);
      const hid = "hw_" + u.reg;
      const kind: NodeKind = info?.direction === "output" ? "hwout" : "hwin";
      addNode({
        id: hid,
        label: u.reg,
        kind,
        color: kind === "hwout" ? HW_OUT_COLOR : HW_IN_COLOR,
        title: info?.description ?? "Hardware register",
      });
      const color = kind === "hwout" ? HW_OUT_COLOR : HW_IN_COLOR;
      if (u.dir === "out") {
        addEdge({ from: u.nodeId, to: hid, label: u.reg, color });
      } else {
        addEdge({ from: hid, to: u.nodeId, label: u.reg, color });
      }
    }

    return { nodes, edges };
  }

  /** Splits the patch into circuit blocks, skipping the controller chain. */
  private parseCircuits(lines: string[]): CircuitInstance[] {
    const instances: CircuitInstance[] = [];
    let declaring = true;
    let current: CircuitInstance | null = null;
    let index = 0;

    lines.forEach((raw, i) => {
      const code = raw.split("#")[0];
      const trimmed = code.trim();
      if (!trimmed) return;

      const hm = trimmed.match(HEADER_RE);
      if (hm) {
        const name = hm[1];
        if (this.data.controllers.has(name) && declaring) return; // chain decl
        declaring = false;
        index++;
        current = {
          index,
          name,
          known: this.data.circuits.has(name),
          headerLine: i,
          params: [],
        };
        instances.push(current);
        return;
      }

      declaring = false;
      if (!current) return;
      const eq = code.indexOf("=");
      if (eq < 0) return;
      const param = code.slice(0, eq).trim().toLowerCase();
      const value = code.slice(eq + 1);
      if (param) current.params.push({ param, value });
    });

    return instances;
  }

  /**
   * Role of a parameter (input/output). For known circuits this comes from the
   * YAML data; for unknown circuits we fall back to the DROID naming convention
   * (parameters named "input..." or "output..." behave accordingly).
   */
  private roleOf(
    inst: CircuitInstance,
    param: string
  ): "input" | "output" | undefined {
    if (inst.known) return this.data.paramRole(inst.name, param);
    if (/^output/.test(param)) return "output";
    if (/^input/.test(param)) return "input";
    return undefined;
  }

  /** Cables (_FOO) and known registers referenced on a value. */
  private extractSignals(
    value: string,
    validRegs: Map<string, unknown>
  ): { cables: string[]; regs: string[] } {
    const cables: string[] = [];
    const regs: string[] = [];
    let m: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(value)) !== null) {
      const tok = m[0];
      if (tok.startsWith("_")) cables.push(tok);
      else if (validRegs.has(tok)) regs.push(tok);
    }
    return { cables, regs };
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/**
 * Manages the circuit graph webview panel (mirrors HardwareViewProvider).
 */
export class CircuitGraphProvider {
  private panel: vscode.WebviewPanel | undefined;
  private document: vscode.TextDocument | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private data: DroidData
  ) {}

  show() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "droid") {
      vscode.window.showInformationMessage("Open a DROID patch file first");
      return;
    }
    this.document = editor.document;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "droidCircuitGraph",
        "DROID Circuit Graph",
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });

      this.panel.webview.onDidReceiveMessage((message) => {
        if (message.command === "reveal" && typeof message.line === "number") {
          this.revealLine(message.line);
        }
      });

      const sub = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === this.document && this.panel) {
          this.updateContent(e.document);
        }
      });
      this.panel.onDidDispose(() => sub.dispose());
    }

    this.updateContent(editor.document);
  }

  private revealLine(line: number) {
    if (!this.document) return;
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document === this.document
    );
    if (!editor) return;
    const range = editor.document.lineAt(
      Math.min(line, editor.document.lineCount - 1)
    ).range;
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }

  private updateContent(document: vscode.TextDocument) {
    if (!this.panel) return;
    const graph = new CircuitGraphBuilder(this.data).build(document.getText());
    this.panel.webview.html = this.generateHTML(graph);
  }

  private generateHTML(graph: Graph): string {
    const json = JSON.stringify(graph).replace(/</g, "\\u003c");
    return (
      HTML_HEAD +
      "<script>window.__GRAPH__=" +
      json +
      ";</script>\n<script>" +
      CLIENT_JS +
      "</script>\n" +
      HTML_TAIL
    );
  }
}

const HTML_HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DROID Circuit Graph</title>
<style>
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    font-family: 'Arial', sans-serif;
    color: #d4b896;
    background-color: #161616;
    overflow: hidden;
  }
  #toolbar {
    position: fixed; top: 0; left: 0; right: 0; height: 38px;
    display: flex; align-items: center; gap: 16px;
    padding: 0 14px; box-sizing: border-box;
    background: #1f1f1f; border-bottom: 1px solid #333;
    font-size: 12px; user-select: none; z-index: 10;
  }
  #toolbar label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
  #toolbar button {
    background: #2d2d2d; color: #d4b896; border: 1px solid #444;
    border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px;
  }
  #toolbar button:hover { background: #383838; }
  #toolbar .legend { display: flex; align-items: center; gap: 5px; opacity: 0.85; }
  #toolbar .swatch { width: 11px; height: 11px; border-radius: 3px; }
  #empty {
    position: fixed; top: 50%; left: 0; right: 0; text-align: center;
    transform: translateY(-50%); opacity: 0.5; font-size: 14px;
  }
  svg { position: fixed; top: 38px; left: 0; width: 100vw; height: calc(100vh - 38px); display: block; }
  .node-box { cursor: pointer; }
  .node-box:hover .node-shape { stroke: #fff; }
  .node-label { font-size: 11px; fill: #fff; pointer-events: none; dominant-baseline: middle; text-anchor: middle; }
  .edge-path { fill: none; pointer-events: stroke; }
  .edge-label { font-size: 9px; fill: #cfcfcf; pointer-events: none; text-anchor: middle; }
</style>
</head>
<body>
<div id="toolbar">
  <strong style="color:#d4b896">Circuit Graph</strong>
  <span style="opacity:0.55">signal flow &rarr;</span>
  <label><input type="checkbox" id="toggle-hw" checked> Hardware I/O</label>
  <label><input type="checkbox" id="toggle-labels"> Cable labels</label>
  <button id="relayout">Re-layout</button>
  <button id="fit">Fit</button>
  <span class="legend"><span class="swatch" style="background:#6ec06e"></span>input</span>
  <span class="legend"><span class="swatch" style="background:#d98c6a"></span>output</span>
  <span id="count" style="margin-left:auto; opacity:0.6"></span>
</div>
<div id="empty" style="display:none">No circuits found in this patch.</div>
<svg id="graph"><g id="viewport"></g></svg>
`;

const HTML_TAIL = `</body>
</html>`;

// Self-contained layered (left-to-right) graph renderer. Written without
// template literals or ${ } so it can live safely inside this TS template
// string.
const CLIENT_JS = `
(function(){
  var vscode = acquireVsCodeApi();
  var DATA = window.__GRAPH__ || { nodes: [], edges: [] };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var svg = document.getElementById("graph");
  var viewport = document.getElementById("viewport");
  var toggleHw = document.getElementById("toggle-hw");
  var toggleLabels = document.getElementById("toggle-labels");

  document.getElementById("empty").style.display =
    DATA.nodes.length ? "none" : "block";
  document.getElementById("count").textContent =
    DATA.nodes.length + " nodes, " + DATA.edges.length + " edges";

  // View transform (pan + zoom).
  var tx = 0, ty = 0, scale = 1;
  function applyTransform(){
    viewport.setAttribute("transform",
      "translate(" + tx + "," + ty + ") scale(" + scale + ")");
  }

  // Active scene (depends on the toolbar toggles).
  var nodes = [], edges = [], nodeById = {}, routes = [];
  var LAYER_GAP = 240, ROW_GAP = 62, COMPONENT_GAP = 110;

  function measure(n){
    if (n.kind === "circuit"){
      n.w = Math.max(64, n.label.length * 7.2 + 22); n.h = 32;
    } else {
      n.w = n.label.length * 8 + 22; n.h = 30;
    }
    n.rx = n.w / 2; n.ry = n.h / 2;
  }

  function buildScene(){
    var showHw = toggleHw.checked;
    nodeById = {};
    nodes = DATA.nodes.filter(function(n){
      return showHw || n.kind === "circuit";
    }).map(function(n){
      var copy = {
        id: n.id, label: n.label, kind: n.kind, color: n.color,
        title: n.title, line: n.line, x: 0, y: 0
      };
      measure(copy);
      nodeById[n.id] = copy;
      return copy;
    });
    edges = DATA.edges.filter(function(e){
      return nodeById[e.from] && nodeById[e.to];
    });
    layout();
    render();
  }

  // ---- Layered left-to-right layout with component separation and edge
  //      routing through dummy waypoints (Sugiyama-style) ----
  function layout(){
    // Undirected adjacency -> connected components (each gets its own band).
    var adjU = {};
    nodes.forEach(function(n){ adjU[n.id] = []; });
    edges.forEach(function(e){ adjU[e.from].push(e.to); adjU[e.to].push(e.from); });
    var comp = {}, compCount = 0;
    nodes.forEach(function(n){
      if (comp[n.id] != null) return;
      var stack = [n.id]; comp[n.id] = compCount;
      while (stack.length){
        var id = stack.pop();
        adjU[id].forEach(function(m){
          if (comp[m] == null){ comp[m] = compCount; stack.push(m); }
        });
      }
      compCount++;
    });

    // Longest-path layering: column = longest producer chain feeding the node.
    var layer = {};
    nodes.forEach(function(n){ layer[n.id] = 0; });
    for (var it = 0; it < nodes.length; it++){
      var changed = false;
      for (var e = 0; e < edges.length; e++){
        var ed = edges[e];
        if (layer[ed.to] < layer[ed.from] + 1){
          layer[ed.to] = layer[ed.from] + 1; changed = true;
        }
      }
      if (!changed) break;
    }

    // Dummy waypoints: an edge spanning N columns gets N-1 invisible nodes so
    // it bends through the gaps between real nodes instead of crossing them.
    var virtuals = [], vc = 0;
    routes = edges.map(function(e){
      var l1 = layer[e.from], l2 = layer[e.to], through = [];
      if (l2 - l1 > 1){
        for (var L = l1 + 1; L < l2; L++){
          var vid = "_v" + (vc++);
          var vn = { id: vid, virtual: true, comp: comp[e.from], vlayer: L,
                     x: 0, y: 0, rx: 0, ry: 0 };
          virtuals.push(vn); nodeById[vid] = vn;
          through.push(vid);
        }
      }
      return [e.from].concat(through, [e.to]);
    });

    function lOf(n){ return n.virtual ? n.vlayer : layer[n.id]; }
    function cOf(n){ return n.virtual ? n.comp : comp[n.id]; }

    // Segment adjacency over the expanded graph (real + dummy nodes).
    var segIn = {}, segOut = {};
    function ensure(id){ if (!segIn[id]) segIn[id] = []; if (!segOut[id]) segOut[id] = []; }
    nodes.forEach(function(n){ ensure(n.id); });
    virtuals.forEach(function(n){ ensure(n.id); });
    routes.forEach(function(r){
      for (var i = 0; i < r.length - 1; i++){
        segOut[r[i]].push(r[i+1]); segIn[r[i+1]].push(r[i]);
      }
    });

    // Group every item by column.
    var items = nodes.concat(virtuals);
    var layers = {}, maxL = 0;
    items.forEach(function(n){
      var L = lOf(n);
      (layers[L] = layers[L] || []).push(n);
      if (L > maxL) maxL = L;
    });

    // Crossing reduction: order each column by the barycenter of its
    // neighbours, keeping components grouped together.
    function posIndex(arr){ var m = {}; arr.forEach(function(n,i){ m[n.id] = i; }); return m; }
    function orderBy(arr, adj, pm){
      arr.forEach(function(n){
        var ns = adj[n.id] || [], s = 0, c = 0;
        ns.forEach(function(id){ if (pm[id] != null){ s += pm[id]; c++; } });
        if (c) n._b = s / c;
      });
      arr.sort(function(a, b){
        return (cOf(a) - cOf(b)) || ((a._b || 0) - (b._b || 0));
      });
    }
    for (var L0 = 0; L0 <= maxL; L0++)
      (layers[L0] || []).sort(function(a, b){ return cOf(a) - cOf(b); });
    for (var pass = 0; pass < 6; pass++){
      for (var L = 1; L <= maxL; L++)
        orderBy(layers[L] || [], segIn, posIndex(layers[L-1] || []));
      for (var L2 = maxL - 1; L2 >= 0; L2--)
        orderBy(layers[L2] || [], segOut, posIndex(layers[L2+1] || []));
    }

    // Record each item's order within its column.
    for (var L3 = 0; L3 <= maxL; L3++)
      (layers[L3] || []).forEach(function(n, i){ n._oi = i; });

    // Coordinates: x by column (shared across components so inputs stay left),
    // y stacked per component, each component placed in its own vertical band.
    var byComp = {};
    items.forEach(function(n){
      var c = cOf(n), L = lOf(n);
      (byComp[c] = byComp[c] || {});
      (byComp[c][L] = byComp[c][L] || []).push(n);
    });
    var compIds = Object.keys(byComp).map(Number).sort(function(a,b){ return a-b; });
    var cursorY = 0;
    compIds.forEach(function(c){
      var cl = byComp[c], maxCount = 0;
      for (var L in cl){ cl[L].sort(function(a,b){ return a._oi - b._oi; });
        if (cl[L].length > maxCount) maxCount = cl[L].length; }
      var bandH = Math.max(1, maxCount) * ROW_GAP;
      var center = cursorY + bandH / 2;
      for (var L4 in cl){
        var arr = cl[L4], totalH = (arr.length - 1) * ROW_GAP;
        arr.forEach(function(n, i){
          n.x = Number(L4) * LAYER_GAP;
          n.y = center - totalH / 2 + i * ROW_GAP;
        });
      }
      cursorY += bandH + COMPONENT_GAP;
    });
  }

  // ---- SVG rendering ----
  var edgeEls = [], nodeEls = [], incident = {};
  function el(name, attrs){
    var e = document.createElementNS(SVG_NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function render(){
    while (viewport.firstChild) viewport.removeChild(viewport.firstChild);
    edgeEls = []; nodeEls = []; incident = {};
    nodes.forEach(function(n){ incident[n.id] = []; });

    var edgeLayer = el("g", {});
    viewport.appendChild(edgeLayer);
    edges.forEach(function(e, i){
      var path = el("path", {
        "class": "edge-path", stroke: e.color,
        "stroke-width": 1.8, "stroke-opacity": 0.5
      });
      var head = el("polygon", { fill: e.color, "fill-opacity": 0.8 });
      var label = el("text", { "class": "edge-label" });
      label.textContent = e.label;
      label.style.display = toggleLabels.checked ? "" : "none";
      edgeLayer.appendChild(path);
      edgeLayer.appendChild(head);
      edgeLayer.appendChild(label);
      var rec = { data: e, route: routes[i], path: path, head: head, label: label };
      edgeEls.push(rec);
      incident[e.from].push(rec); incident[e.to].push(rec);
    });

    var nodeLayer = el("g", {});
    viewport.appendChild(nodeLayer);
    nodes.forEach(function(n){
      var g = el("g", { "class": "node-box" });
      var title = el("title", {});
      title.textContent = n.title || n.label;
      g.appendChild(title);

      var shape = el("rect", {
        "class": "node-shape", x: -n.rx, y: -n.ry, width: n.w, height: n.h,
        rx: (n.kind === "circuit") ? 7 : 15, ry: (n.kind === "circuit") ? 7 : 15,
        fill: (n.kind === "circuit") ? n.color : "#222",
        stroke: (n.kind === "circuit") ? "#000" : n.color,
        "stroke-width": (n.kind === "circuit") ? 1.5 : 2
      });
      g.appendChild(shape);

      var text = el("text", { "class": "node-label" });
      text.textContent = n.label;
      if (n.kind !== "circuit") text.setAttribute("fill", n.color);
      g.appendChild(text);

      attachInteraction(g, n);
      nodeLayer.appendChild(g);
      var rec = { data: n, g: g };
      nodeEls.push(rec);
      n._el = rec;
    });
    paint();
    setTimeout(fit, 0);
  }

  // Build a smooth left-to-right path through the route's waypoints.
  function edgeGeom(route){
    var pts = route.map(function(id){ var n = nodeById[id]; return { x: n.x, y: n.y }; });
    var s = nodeById[route[0]], t = nodeById[route[route.length - 1]];
    var dirS = (pts[1].x >= s.x) ? 1 : -1;
    var dirE = (t.x >= pts[pts.length - 2].x) ? 1 : -1;
    var P = [{ x: s.x + dirS * s.rx, y: s.y }];
    for (var i = 1; i < pts.length - 1; i++) P.push(pts[i]);
    P.push({ x: t.x - dirE * t.rx, y: t.y });
    var d = "M " + P[0].x + " " + P[0].y;
    for (var j = 1; j < P.length; j++){
      var a = P[j-1], b = P[j], mx = (a.x + b.x) / 2;
      d += " C " + mx + " " + a.y + " " + mx + " " + b.y + " " + b.x + " " + b.y;
    }
    var mid = P[Math.floor(P.length / 2)];
    if (P.length % 2 === 0){
      var m1 = P[P.length/2 - 1], m2 = P[P.length/2];
      mid = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 };
    }
    return { d: d, end: P[P.length - 1], dirE: dirE, mid: mid };
  }

  // Update SVG geometry from the model.
  function paint(){
    nodeEls.forEach(function(ne){
      ne.g.setAttribute("transform",
        "translate(" + ne.data.x + "," + ne.data.y + ")");
    });
    edgeEls.forEach(function(ee){
      var r = edgeGeom(ee.route);
      ee.path.setAttribute("d", r.d);
      var ux = r.dirE, uy = 0, sz = 7, px = -uy, py = ux;
      var ex = r.end.x, ey = r.end.y;
      ee.head.setAttribute("points",
        ex + "," + ey + " " +
        (ex - ux*sz + px*sz*0.6) + "," + (ey - uy*sz + py*sz*0.6) + " " +
        (ex - ux*sz - px*sz*0.6) + "," + (ey - uy*sz - py*sz*0.6));
      ee.label.setAttribute("x", r.mid.x);
      ee.label.setAttribute("y", r.mid.y - 4);
    });
  }

  // ---- Hover highlight: focus a node and its direct connections ----
  function highlight(node){
    var keep = {}; keep[node.id] = true;
    var inc = incident[node.id];
    inc.forEach(function(ee){ keep[ee.data.from] = true; keep[ee.data.to] = true; });
    edgeEls.forEach(function(ee){
      var on = inc.indexOf(ee) >= 0;
      ee.path.setAttribute("stroke-opacity", on ? 0.95 : 0.04);
      ee.path.setAttribute("stroke-width", on ? 2.6 : 1.8);
      ee.head.setAttribute("fill-opacity", on ? 1 : 0.04);
      ee.label.style.display = on ? "" : (toggleLabels.checked ? "" : "none");
    });
    nodeEls.forEach(function(ne){ ne.g.style.opacity = keep[ne.data.id] ? 1 : 0.2; });
  }
  function clearHighlight(){
    edgeEls.forEach(function(ee){
      ee.path.setAttribute("stroke-opacity", 0.5);
      ee.path.setAttribute("stroke-width", 1.8);
      ee.head.setAttribute("fill-opacity", 0.8);
      ee.label.style.display = toggleLabels.checked ? "" : "none";
    });
    nodeEls.forEach(function(ne){ ne.g.style.opacity = 1; });
  }

  // ---- Interaction: hover, drag, click-to-reveal ----
  function attachInteraction(g, n){
    g.addEventListener("mouseenter", function(){ highlight(n); });
    g.addEventListener("mouseleave", function(){ clearHighlight(); });
    g.addEventListener("pointerdown", function(ev){
      ev.stopPropagation();
      g.setPointerCapture(ev.pointerId);
      var moved = false;
      function move(e){
        moved = true;
        var p = toWorld(e.clientX, e.clientY);
        n.x = p.x; n.y = p.y;
        paint();
      }
      function up(){
        g.releasePointerCapture(ev.pointerId);
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        if (!moved && n.line != null){
          vscode.postMessage({ command: "reveal", line: n.line });
        }
      }
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
    });
  }

  function toWorld(clientX, clientY){
    var rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - tx) / scale,
      y: (clientY - rect.top - ty) / scale
    };
  }

  // Pan with background drag.
  var panning = false, panStart = null;
  svg.addEventListener("pointerdown", function(ev){
    panning = true;
    panStart = { x: ev.clientX - tx, y: ev.clientY - ty };
  });
  svg.addEventListener("pointermove", function(ev){
    if (!panning) return;
    tx = ev.clientX - panStart.x;
    ty = ev.clientY - panStart.y;
    applyTransform();
  });
  svg.addEventListener("pointerup", function(){ panning = false; });
  svg.addEventListener("pointerleave", function(){ panning = false; });

  // Zoom with wheel, centered on the cursor.
  svg.addEventListener("wheel", function(ev){
    ev.preventDefault();
    var rect = svg.getBoundingClientRect();
    var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    var factor = ev.deltaY < 0 ? 1.1 : 1/1.1;
    var ns = Math.min(4, Math.max(0.1, scale * factor));
    tx = mx - (mx - tx) * (ns / scale);
    ty = my - (my - ty) * (ns / scale);
    scale = ns;
    applyTransform();
  }, { passive: false });

  function fit(){
    if (!nodes.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function(n){
      minX = Math.min(minX, n.x - n.rx); maxX = Math.max(maxX, n.x + n.rx);
      minY = Math.min(minY, n.y - n.ry); maxY = Math.max(maxY, n.y + n.ry);
    });
    var w = maxX - minX, h = maxY - minY;
    var vw = svg.clientWidth, vh = svg.clientHeight;
    scale = Math.min(2, Math.max(0.1, Math.min(vw/(w+100), vh/(h+100))));
    tx = (vw - w*scale)/2 - minX*scale;
    ty = (vh - h*scale)/2 - minY*scale;
    applyTransform();
  }

  // ---- Toolbar ----
  toggleHw.addEventListener("change", buildScene);
  toggleLabels.addEventListener("change", function(){
    edgeEls.forEach(function(ee){
      ee.label.style.display = toggleLabels.checked ? "" : "none";
    });
  });
  document.getElementById("relayout").addEventListener("click", function(){
    layout(); paint(); fit();
  });
  document.getElementById("fit").addEventListener("click", fit);

  buildScene();
})();
`;
