// Circuit graph webview panel, rendered as a read-only Unreal-Engine-style
// "blueprint" graph. Every circuit instance becomes a node with a colored
// header (the circuit type) and a body listing only the inputs and outputs
// that are actually used in the patch. Input pins decompose the DROID
// `A * B + C` value form into stacked rows: the base operand sits on the pin
// row, the multiplier on a `×`/`÷` row and the offset on a `+`/`−` row (see §6
// of reference.md). Internal cables (_NAME) are drawn as wires from the
// producing output pin to the consuming input row; hardware registers
// (I/O/P...) and constants are kept as separate little nodes / inline text.

import * as vscode from "vscode";
import { DroidData } from "./data";
import { colorForCable } from "./cables";
import { Blueprint, BlueprintPort, parseBlueprint } from "./blueprints";
import { parseLabelLegend } from "./labels";
import { BlueprintRegistry } from "./blueprintRegistry";
import { tokenizeForRows } from "./maths";

const HEADER_RE = /^\[([a-z0-9]+)\]$/;

interface CircuitInstance {
  index: number; // 1-based position among circuits in the patch
  name: string; // circuit type (e.g. "copy")
  known: boolean; // is it a documented circuit?
  headerLine: number; // line of the [header], for "reveal in editor"
  params: { param: string; name: string; value: string }[];
}

type NodeKind = "circuit" | "hwin" | "hwout";

/** One stacked row of an input pin (base operand, or a `×`/`+`/... modifier). */
interface PinRow {
  op: "" | "*" | "/" | "+" | "-"; // operator preceding the operand ("" = base)
  text: string; // operand as written (cable, register or constant)
  conn: boolean; // is the operand a connectable signal (cable/register)?
  color: string; // wire/pin color (cable color or hardware color)
  // Formula rows (arithmetic expression split across rows): signals are
  // drawn as a colored dot (name on hover), with parentheses around them.
  formula?: boolean;
  open?: number; // parentheses opening before the operand
  close?: number; // parentheses closing after the operand
}

interface InputPin {
  key: string; // parameter key (lowercased), used to build pin ids
  name: string; // display name, as written
  rows: PinRow[];
}

interface OutputPin {
  key: string;
  name: string;
  text: string; // value, as written
  conn: boolean;
  color: string;
}

interface GraphNode {
  id: string;
  kind: NodeKind;
  // circuit nodes
  name?: string; // circuit type
  title?: string; // human title for the tooltip
  color?: string; // header color
  line?: number; // header line, for reveal-in-editor
  inputs?: InputPin[];
  outputs?: OutputPin[];
  // hardware nodes
  label?: string; // register name (I1, O2, P3.1...)
  hwColor?: string;
  flabel?: string; // Forge short label from the file's legend (e.g. "TRIG")
  fdesc?: string; // Forge long description from the file's legend
}

interface GraphEdge {
  from: string; // source node id
  fromPin: string; // pin id within the source node
  to: string; // target node id
  toPin: string; // pin id within the target node
  color: string;
  label: string; // signal name (cable like _FOO, or register like I1)
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const HW_IN_COLOR = "#6ec06e";
const HW_OUT_COLOR = "#d98c6a";
const CONST_NUM_COLOR = "#caa24a"; // numbers, voltages, percentages
const CONST_GATE_COLOR = "#569cd6"; // gates (on/off)

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

/** A single operand parsed out of an input expression, plus its operator. */
interface ExprToken {
  op: "" | "*" | "/" | "+" | "-";
  operand: string;
}

/**
 * Tokenizes a DROID input expression into operand tokens, each tagged with the
 * operator that precedes it. The DROID value grammar is the restricted
 * `A * B + C` form (one multiplication, one addition, shorthands for negation,
 * division-by-constant and subtraction), so a flat left-to-right scan is
 * enough — no need for precedence. A leading `-`/`+` is treated as part of the
 * following operand (a sign) rather than as a binary operator.
 */
function tokenizeExpr(value: string): ExprToken[] {
  const s = value.trim();
  const out: ExprToken[] = [];
  let i = 0;
  let pendingOp: ExprToken["op"] = "";
  let expectOperand = true;
  const isOp = (c: string) =>
    c === "*" || c === "/" || c === "+" || c === "-";

  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (!expectOperand && isOp(c)) {
      pendingOp = c as ExprToken["op"];
      i++;
      expectOperand = true;
      continue;
    }
    // Read an operand. When an operand is expected a leading +/- is its sign.
    let j = i;
    if (s[j] === "-" || s[j] === "+") j++;
    while (j < s.length) {
      const d = s[j];
      if (d === " " || d === "\t" || isOp(d)) break;
      j++;
    }
    const operand = s.slice(i, j);
    if (operand) out.push({ op: pendingOp, operand });
    pendingOp = "";
    expectOperand = false;
    i = j;
  }
  return out;
}

/**
 * Classifies an operand as a connectable signal (cable or hardware register)
 * or a plain constant, and gives it a wire color. The optional leading sign is
 * ignored for classification but kept in the displayed text by the caller.
 */
function classifyOperand(
  raw: string,
  validRegs: Map<string, { direction: string }>
): { conn: boolean; cable?: string; reg?: string; color: string } {
  let t = raw;
  if (t[0] === "-" || t[0] === "+") t = t.slice(1);
  if (t.startsWith("_")) {
    return { conn: true, cable: t, color: colorForCable(t) };
  }
  const info = validRegs.get(t);
  if (info) {
    const color = info.direction === "output" ? HW_OUT_COLOR : HW_IN_COLOR;
    return { conn: true, reg: t, color };
  }
  // Plain constant: gates (on/off) get their own color so they read as boolean.
  const lower = t.toLowerCase();
  const isGate = lower === "on" || lower === "off";
  return { conn: false, color: isGate ? CONST_GATE_COLOR : CONST_NUM_COLOR };
}

/**
 * Builds the blueprint-style graph for a patch. Pure logic (no VSCode), so it
 * can be unit-tested independently of the webview.
 */
export class CircuitGraphBuilder {
  private blueprints: Map<string, Blueprint>;

  constructor(private data: DroidData, blueprints?: Map<string, Blueprint>) {
    this.blueprints = blueprints ?? new Map();
  }

  /**
   * `blueprint`: the text is a megacircuit definition. Its `[input]`/`[output]`
   * sections are not circuits; their ports are drawn like hardware jacks (the
   * megacircuit's public interface) and the body circuits wire to them.
   */
  build(text: string, opts: { blueprint?: boolean } = {}): Graph {
    const lines = text.split(/\r?\n/);
    const chain = this.data.controllerChain(lines);
    const validRegs = this.data.validRegisters(chain) as Map<
      string,
      { direction: string; description?: string }
    >;
    const legend = parseLabelLegend(text);
    const instances = this.parseCircuits(lines, !!opts.blueprint);

    // Blueprint ports behave like registers: referenced by bare name in values.
    const ports = new Map<string, { kind: NodeKind; port: BlueprintPort }>();
    if (opts.blueprint) {
      const def = parseBlueprint(text, "");
      for (const port of def.inputs) ports.set(port.name, { kind: "hwin", port });
      for (const port of def.outputs) ports.set(port.name, { kind: "hwout", port });
      for (const [name, { kind }] of ports) {
        validRegs.set(name, {
          direction: kind === "hwout" ? "output" : "input",
          description: kind === "hwout" ? "Megacircuit output" : "Megacircuit input",
        });
      }
    }

    const nodes: GraphNode[] = [];
    const nodeIds = new Set<string>();
    const addNode = (n: GraphNode) => {
      if (!nodeIds.has(n.id)) {
        nodeIds.add(n.id);
        nodes.push(n);
      }
    };

    // Per cable: which output pins produce it and which input rows consume it.
    const cableProducers = new Map<string, { node: string; pin: string }[]>();
    const cableConsumers = new Map<string, { node: string; pin: string }[]>();
    // Hardware registers actually referenced, with the kind they render as.
    const hwUsed = new Map<string, NodeKind>();
    const hwEdges: GraphEdge[] = [];

    for (const inst of instances) {
      const nid = "c" + inst.index;
      const inputs: InputPin[] = [];
      const outputs: OutputPin[] = [];

      for (const p of inst.params) {
        if (!p.value.trim()) continue;
        const role = this.roleOf(inst, p.param);

        if (role === "output") {
          const tokens = tokenizeExpr(p.value);
          const first = tokens[0];
          const cls = first
            ? classifyOperand(first.operand, validRegs)
            : { conn: false, color: "#777" as string };
          const pinId = "o:" + p.param;
          outputs.push({
            key: p.param,
            name: p.name,
            text: p.value.trim(),
            conn: cls.conn,
            color: cls.color,
          });
          if (cls.cable) {
            push(cableProducers, cls.cable, { node: nid, pin: pinId });
          } else if (cls.reg) {
            const kind: NodeKind =
              validRegs.get(cls.reg)!.direction === "output"
                ? "hwout"
                : "hwin";
            hwUsed.set(cls.reg, kind);
            hwEdges.push({
              from: nid,
              fromPin: pinId,
              to: "hw_" + cls.reg,
              toPin: "p",
              color: cls.color,
              label: cls.reg,
            });
          }
        } else if (p.value.includes("(") && tokenizeForRows(p.value).length) {
          // Complex math sugar (parentheses): split the expression into one row
          // per operand (parens attached to the operands they wrap), so each
          // input gets its own pin/row instead of all sharing one.
          const toks = tokenizeForRows(p.value);
          const rows: PinRow[] = toks.map((t) => {
            const cls = classifyOperand(t.bare, validRegs);
            return {
              op: t.op,
              text: t.bare,
              conn: cls.conn,
              color: cls.color,
              formula: true,
              open: t.open,
              close: t.close,
            };
          });
          inputs.push({ key: p.param, name: p.name, rows });

          toks.forEach((t, idx) => {
            const cls = classifyOperand(t.bare, validRegs);
            const pin = "i:" + p.param + ":" + idx;
            if (cls.cable) {
              push(cableConsumers, cls.cable, { node: nid, pin });
            } else if (cls.reg) {
              const kind: NodeKind =
                validRegs.get(cls.reg)!.direction === "output" ? "hwout" : "hwin";
              hwUsed.set(cls.reg, kind);
              hwEdges.push({
                from: "hw_" + cls.reg,
                fromPin: "p",
                to: nid,
                toPin: pin,
                color: cls.color,
                label: cls.reg,
              });
            }
          });
        } else {
          // Treat input role and unknown role alike (most params are inputs).
          const tokens = tokenizeExpr(p.value);
          // Even without parentheses, place signal dots after their operator
          // inside the card so every formula reads in expression order.
          const formula = tokens.length > 1;
          const rows: PinRow[] = tokens.map((t) => {
            const cls = classifyOperand(t.operand, validRegs);
            return {
              op: t.op,
              text: t.operand,
              conn: cls.conn,
              color: cls.color,
              formula,
            };
          });
          inputs.push({ key: p.param, name: p.name, rows });

          tokens.forEach((t, idx) => {
            const cls = classifyOperand(t.operand, validRegs);
            const pin = "i:" + p.param + ":" + idx;
            if (cls.cable) {
              push(cableConsumers, cls.cable, { node: nid, pin });
            } else if (cls.reg) {
              const kind: NodeKind =
                validRegs.get(cls.reg)!.direction === "output"
                  ? "hwout"
                  : "hwin";
              hwUsed.set(cls.reg, kind);
              hwEdges.push({
                from: "hw_" + cls.reg,
                fromPin: "p",
                to: nid,
                toPin: pin,
                color: cls.color,
                label: cls.reg,
              });
            }
          });
        }
      }

      const circuit = this.data.circuits.get(inst.name);
      const bp = this.blueprints.get(inst.name);
      const title = circuit
        ? circuit.title
        : bp
        ? bp.doc?.split("\n")[0] ?? "Megacircuit"
        : "Unknown circuit";
      addNode({
        id: nid,
        kind: "circuit",
        name: inst.name,
        title,
        color: colorForCircuit(inst.name),
        line: inst.headerLine,
        inputs,
        outputs,
      });
    }

    // Hardware nodes (one per referenced register), enriched with the file's
    // Forge label legend so a hover can show the documented label/description.
    for (const [reg, kind] of hwUsed) {
      if (ports.has(reg)) continue; // drawn below, with the port's own docs
      const li = legend.get(reg);
      addNode({
        id: "hw_" + reg,
        kind,
        label: reg,
        hwColor: kind === "hwout" ? HW_OUT_COLOR : HW_IN_COLOR,
        title: li?.description ?? validRegs.get(reg)?.description ?? "Hardware register",
        flabel: li?.label,
        fdesc: li?.description,
      });
    }

    // Megacircuit ports: the whole interface, even ports not wired yet.
    for (const [name, { kind, port }] of ports) {
      const role = kind === "hwout" ? "output" : "input";
      const desc = [
        port.doc,
        port.default !== undefined ? "default: " + port.default : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      addNode({
        id: "hw_" + name,
        kind,
        label: name,
        hwColor: kind === "hwout" ? HW_OUT_COLOR : HW_IN_COLOR,
        title: "Megacircuit " + role,
        line: port.line,
        flabel: "megacircuit " + role,
        fdesc: desc || undefined,
      });
    }

    const edges: GraphEdge[] = [];
    const seenEdge = new Set<string>();
    const addEdge = (e: GraphEdge) => {
      const key = e.from + "/" + e.fromPin + "->" + e.to + "/" + e.toPin;
      if (!seenEdge.has(key)) {
        seenEdge.add(key);
        edges.push(e);
      }
    };

    // Cable wires: every producing output pin -> every consuming input row.
    for (const [cable, producers] of cableProducers) {
      const consumers = cableConsumers.get(cable) ?? [];
      const color = colorForCable(cable);
      for (const prod of producers) {
        for (const cons of consumers) {
          if (prod.node !== cons.node) {
            addEdge({
              from: prod.node,
              fromPin: prod.pin,
              to: cons.node,
              toPin: cons.pin,
              color,
              label: cable,
            });
          }
        }
      }
    }
    for (const e of hwEdges) addEdge(e);

    return { nodes, edges };
  }

  /** Splits the patch into circuit blocks, skipping the controller chain. */
  private parseCircuits(lines: string[], blueprint = false): CircuitInstance[] {
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
        if (blueprint && (name === "input" || name === "output")) {
          current = null; // port section, not a circuit
          return;
        }
        index++;
        current = {
          index,
          name,
          known: this.data.circuits.has(name) || this.blueprints.has(name),
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
      const name = code.slice(0, eq).trim();
      const value = code.slice(eq + 1);
      if (name) {
        current.params.push({ param: name.toLowerCase(), name, value });
      }
    });

    return instances;
  }

  /**
   * Role of a parameter (input/output). Documented circuits use the YAML data;
   * megacircuit instances use their blueprint's port interface (so they render
   * as ordinary nodes); unknown circuits fall back to the DROID naming
   * convention (parameters named "input..." / "output..." behave accordingly).
   */
  private roleOf(
    inst: CircuitInstance,
    param: string
  ): "input" | "output" | undefined {
    if (this.data.circuits.has(inst.name)) {
      return this.data.paramRole(inst.name, param);
    }
    const bp = this.blueprints.get(inst.name);
    if (bp) {
      if (bp.inputs.some((p) => p.name.toLowerCase() === param)) return "input";
      if (bp.outputs.some((p) => p.name.toLowerCase() === param)) return "output";
      return undefined;
    }
    if (/^output/.test(param)) return "output";
    if (/^input/.test(param)) return "input";
    return undefined;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/** Languages the graph can show: patches and megacircuit definitions. */
const GRAPH_LANGUAGES = ["droid", "droider", "droid-blueprint"];

/**
 * Manages the circuit graph webview panel (mirrors HardwareViewProvider).
 */
export class CircuitGraphProvider {
  static readonly viewType = "droidCircuitGraph";

  private panel: vscode.WebviewPanel | undefined;
  private document: vscode.TextDocument | undefined;
  private subs: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private data: DroidData,
    private registry?: BlueprintRegistry
  ) {}

  show() {
    const editor = vscode.window.activeTextEditor;
    // .ini patches and .droider patches (which may use megacircuits) are both
    // shown; megacircuit instances render as ordinary circuit nodes.
    if (!editor || !GRAPH_LANGUAGES.includes(editor.document.languageId)) {
      vscode.window.showInformationMessage(
        "Open a DROID patch (.ini, .droider or .blueprint) first"
      );
      return;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.adopt(
        vscode.window.createWebviewPanel(
          CircuitGraphProvider.viewType,
          "DROID Circuit Graph",
          vscode.ViewColumn.Beside,
          { enableScripts: true, retainContextWhenHidden: true }
        )
      );
    }

    this.setDocument(editor.document);
  }

  /**
   * Revive a panel restored by VSCode after a window reload. The originating
   * document is recovered from the persisted webview state (its URI); if that
   * fails we fall back to any open DROID patch so the pane is never left blank.
   */
  async restore(panel: vscode.WebviewPanel, state: unknown) {
    this.adopt(panel);
    const document = await this.documentFromState(state);
    if (document) this.setDocument(document);
  }

  /** Wire up a (new or revived) panel: lifecycle, messages, live updates. */
  private adopt(panel: vscode.WebviewPanel) {
    this.panel = panel;
    // A revived panel comes back with scripts disabled; re-enable them.
    panel.webview.options = { enableScripts: true };

    panel.onDidDispose(() => {
      this.panel = undefined;
      this.document = undefined;
      this.subs.forEach((s) => s.dispose());
      this.subs = [];
    });

    this.subs.push(
      panel.webview.onDidReceiveMessage((message) => {
        if (message.command === "reveal" && typeof message.line === "number") {
          this.revealLine(message.line);
        }
      })
    );

    this.subs.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.document && e.document === this.document && this.panel) {
          this.updateContent(e.document);
        }
      })
    );

    // A megacircuit edit changes how instances render: rebuild on registry change.
    if (this.registry) {
      this.subs.push(
        this.registry.onDidChange(() => {
          if (this.document && this.panel) this.updateContent(this.document);
        })
      );
    }
  }

  private setDocument(document: vscode.TextDocument) {
    this.document = document;
    this.updateContent(document);
  }

  private async documentFromState(
    state: unknown
  ): Promise<vscode.TextDocument | undefined> {
    const uri =
      state && typeof (state as { uri?: unknown }).uri === "string"
        ? (state as { uri: string }).uri
        : undefined;
    if (uri) {
      try {
        return await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      } catch {
        /* fall through to a sensible default */
      }
    }
    const active = vscode.window.activeTextEditor;
    if (active && GRAPH_LANGUAGES.includes(active.document.languageId)) {
      return active.document;
    }
    return vscode.workspace.textDocuments.find((d) =>
      GRAPH_LANGUAGES.includes(d.languageId)
    );
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
    const graph = new CircuitGraphBuilder(
      this.data,
      this.registry?.all()
    ).build(document.getText(), {
      blueprint: document.languageId === "droid-blueprint",
    });
    this.panel.webview.html = this.generateHTML(graph, document.uri.toString());
  }

  private generateHTML(graph: Graph, docUri: string): string {
    const json = JSON.stringify(graph).replace(/</g, "\\u003c");
    const uri = JSON.stringify(docUri).replace(/</g, "\\u003c");
    return (
      HTML_HEAD +
      "<script>window.__GRAPH__=" +
      json +
      ";window.__DOC_URI__=" +
      uri +
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
    font-family: 'Segoe UI', 'Arial', sans-serif;
    color: #d4b896;
    background-color: #0f0f10;
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
  svg {
    position: fixed; top: 38px; left: 0; width: 100vw; height: calc(100vh - 38px);
    display: block;
    background-image: radial-gradient(#1d1d20 1px, transparent 1px);
    background-size: 22px 22px;
  }
  .node { cursor: grab; }
  .node:active { cursor: grabbing; }
  .node-body { stroke: #050505; stroke-width: 1; }
  .node:hover .node-body { stroke: #fff; }
  .hw-body { stroke-width: 2; }
  .header-text { font-size: 11.5px; font-weight: 600; fill: #0c0c0c; pointer-events: none; dominant-baseline: middle; }
  .pin-name { font-size: 11px; fill: #ededed; pointer-events: none; dominant-baseline: middle; }
  .pin-base { font-weight: 600; }
  .pin-sub { fill: #b7b7b7; }
  .pin-op { fill: #f0c674; font-weight: 700; }
  .chip-text { font-size: 10px; font-weight: 700; fill: #161616; pointer-events: none; dominant-baseline: middle; text-anchor: middle; }
  .hw-label { font-size: 11.5px; font-weight: 600; pointer-events: none; dominant-baseline: middle; text-anchor: middle; }
  .edge-path { fill: none; pointer-events: stroke; cursor: pointer; }
  .wire-label { font-size: 10.5px; font-weight: 600; dominant-baseline: middle; text-anchor: middle; pointer-events: none; }
  #tooltip {
    position: fixed; z-index: 20; max-width: 280px; display: none;
    background: #0c0c0e; border: 1px solid #555; border-radius: 6px;
    padding: 7px 9px; font-size: 12px; color: #ddd; pointer-events: none;
    box-shadow: 0 4px 14px rgba(0,0,0,0.5); line-height: 1.35;
  }
  #tooltip .tt-label {
    display: inline-block; font-weight: 700; color: #161616;
    background: #d4b896; border-radius: 3px; padding: 1px 6px; margin-bottom: 4px;
  }
  #tooltip .tt-reg { color: #888; font-weight: 600; margin-left: 6px; }
  #tooltip .tt-desc { color: #cfcfcf; }
</style>
</head>
<body>
<div id="toolbar">
  <strong style="color:#d4b896">Circuit Graph</strong>
  <span style="opacity:0.55">signal flow &rarr;</span>
  <label><input type="checkbox" id="toggle-hw" checked> Hardware I/O</label>
  <button id="relayout">Re-layout</button>
  <button id="fit">Fit</button>
  <span class="legend"><span class="swatch" style="background:#6ec06e"></span>input reg</span>
  <span class="legend"><span class="swatch" style="background:#d98c6a"></span>output reg</span>
  <span id="count" style="margin-left:auto; opacity:0.6"></span>
</div>
<div id="empty" style="display:none">No circuits found in this patch.</div>
<div id="tooltip"></div>
<svg id="graph"><g id="viewport"></g></svg>
`;

const HTML_TAIL = `</body>
</html>`;

// Self-contained blueprint-style renderer. Written without template literals or
// ${ } so it can live safely inside this TS template string.
const CLIENT_JS = `
(function(){
  var vscode = acquireVsCodeApi();
  // Persist the source document URI so the pane can be revived with its
  // content after a window reload (WebviewPanelSerializer).
  try { vscode.setState({ uri: window.__DOC_URI__ }); } catch (e) {}
  var DATA = window.__GRAPH__ || { nodes: [], edges: [] };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var svg = document.getElementById("graph");
  var viewport = document.getElementById("viewport");
  var toggleHw = document.getElementById("toggle-hw");
  var tooltip = document.getElementById("tooltip");

  document.getElementById("empty").style.display =
    DATA.nodes.length ? "none" : "block";

  // ---- geometry constants ----
  var HEADER_H = 24, ROW_H = 17, PAD_X = 9, PAD_BOTTOM = 8;
  var COL_GAP = 22, PIN_R = 4.5;
  var LAYER_GAP = 70, NODE_VGAP = 26, COMPONENT_GAP = 60, DUMMY_H = 14;

  // Accurate text width via an offscreen canvas (a fixed char width can't cope
  // with bold names + proportional fonts, which left chips mis-placed).
  var _ctx = document.createElement("canvas").getContext("2d");
  var FONT_FAMILY = "'Segoe UI', Arial, sans-serif";
  function tw(text, weight, size){
    _ctx.font = (weight || "400") + " " + (size || 11) + "px " + FONT_FAMILY;
    return _ctx.measureText(text).width;
  }
  var HEAD_GAP = 6; // space between a pin label and its operand/chip
  var PART_GAP = 3; // space between parts of a formula row (parens, dots, chips)

  // View transform (pan + zoom).
  var tx = 0, ty = 0, scale = 1;
  function applyTransform(){
    viewport.setAttribute("transform",
      "translate(" + tx + "," + ty + ") scale(" + scale + ")");
  }

  var nodes = [], edges = [], routes = [], nodeById = {}, incident = {};

  // Signal names are revealed on hover; constants are always shown.
  function operandText(text, conn){
    return conn ? "" : text;
  }

  // Glyph shown for a row's leading operator ("" for the base/first operand).
  function glyphFor(op){
    return op === "*" ? "\\u00d7" : op === "/" ? "\\u00f7"
      : op === "-" ? "\\u2212" : op === "+" ? "+" : "";
  }

  // Build the displayed rows for a node and measure its box + pin offsets.
  function prepare(n){
    n.pins = {};
    if (n.kind !== "circuit"){
      n.w = Math.max(46, tw(n.label, "600") + 22);
      n.h = 26;
      var px = (n.kind === "hwout") ? -n.w/2 : n.w/2;
      n.pins["p"] = { x: px, y: 0 };
      return;
    }

    var left = [], right = [];
    (n.inputs || []).forEach(function(pin){
      // Formulas start with "parameter ="; continuation operators return to
      // the left margin rather than indenting under the right-hand side.
      var isFormula = pin.rows.some(function(r){ return r.formula; });
      var formulaStart = isFormula ? tw(pin.name + " =", "600") + HEAD_GAP : 0;
      var glyphCol = 0;
      if (isFormula) pin.rows.forEach(function(r){
        if (r.op !== "") glyphCol = Math.max(glyphCol, tw(glyphFor(r.op), "700"));
      });

      pin.rows.forEach(function(r, idx){
        var base = r.op === "";
        var lrow = {
          pinId: "i:" + pin.key + ":" + idx,
          base: base, conn: r.conn, color: r.color
        };
        if (r.formula){
          // A formula operand: the operator (fixed column), optional parens
          // (neutral, bold), then a colored dot for a signal or a chip for a
          // constant. Keep the assignment label before the first operand.
          lrow.head = base ? pin.name + " =" : glyphFor(r.op);
          var headSpace = base ? formulaStart : glyphCol + HEAD_GAP;
          lrow.headSpace = headSpace;
          var parts = [];
          if (r.open) { var ops = "(".repeat(r.open); parts.push({ t: "paren", s: ops, w: tw(ops, "800") }); }
          if (r.conn) parts.push({ t: "dot", color: r.color, w: 2 * PIN_R });
          else parts.push({ t: "chip", s: r.text, color: r.color, w: chipWidth(r.text) });
          if (r.close) { var cps = ")".repeat(r.close); parts.push({ t: "paren", s: cps, w: tw(cps, "800") }); }
          var pw = 0; parts.forEach(function(p){ pw += p.w; });
          lrow.parts = parts;
          lrow.width = headSpace + pw + Math.max(0, parts.length - 1) * PART_GAP;
          // Center x of the signal dot (offset from the node's left border), so
          // the incoming wire can run all the way into it (no separate pin).
          var ox = PAD_X + headSpace;
          for (var pi = 0; pi < parts.length; pi++){
            if (pi) ox += PART_GAP;
            if (parts[pi].t === "dot"){ lrow.dotX = ox + PIN_R; break; }
            ox += parts[pi].w;
          }
        } else {
          var head = base ? pin.name : glyphFor(r.op);
          var headW = tw(head, base ? "600" : "700");
          lrow.head = head; lrow.headW = headW;
          var operand = operandText(r.text, r.conn);
          var opW = 0;
          if (operand) opW = r.conn ? tw(operand, "400") : chipWidth(operand);
          lrow.operand = operand;
          lrow.width = headW + (operand ? HEAD_GAP + opW : 0);
        }
        left.push(lrow);
      });
    });
    (n.outputs || []).forEach(function(pin){
      var operand = operandText(pin.text, pin.conn);
      var nameW = tw(pin.name, "600");
      var opW = 0;
      if (operand) opW = pin.conn ? tw(operand, "400") : chipWidth(operand);
      right.push({
        pinId: "o:" + pin.key, name: pin.name, nameW: nameW, operand: operand,
        conn: pin.conn, color: pin.color,
        width: nameW + (operand ? HEAD_GAP + opW : 0)
      });
    });
    n._left = left; n._right = right;

    var leftW = 0, rightW = 0;
    left.forEach(function(r){ if (r.width > leftW) leftW = r.width; });
    right.forEach(function(r){ if (r.width > rightW) rightW = r.width; });
    var bodyW = PAD_X * 2 + leftW + ((leftW && rightW) ? COL_GAP : 0) + rightW;
    var headW = tw(n.name, "600", 11.5) + PAD_X * 2;
    n.w = Math.max(96, bodyW, headW);
    var rowCount = Math.max(left.length, right.length, 1);
    n.h = HEADER_H + rowCount * ROW_H + PAD_BOTTOM;

    function rowY(k){ return -n.h/2 + HEADER_H + k * ROW_H + ROW_H/2; }
    left.forEach(function(r, k){
      r.y = rowY(k);
      n.pins[r.pinId] = { x: -n.w/2, y: r.y };
    });
    right.forEach(function(r, k){
      r.y = rowY(k);
      n.pins[r.pinId] = { x: n.w/2, y: r.y };
    });
  }

  function buildScene(){
    var showHw = toggleHw.checked;
    nodeById = {};
    nodes = DATA.nodes.filter(function(n){
      return showHw || n.kind === "circuit";
    }).map(function(n){
      var copy = JSON.parse(JSON.stringify(n));
      copy.x = 0; copy.y = 0;
      prepare(copy);
      nodeById[n.id] = copy;
      return copy;
    });
    edges = DATA.edges.filter(function(e){
      return nodeById[e.from] && nodeById[e.to];
    });
    layout();
    render();
    setTimeout(fit, 0);
  }

  // ---- Sugiyama-style layered layout: longest-path layers, ghost waypoints
  //      for long edges, barycenter ordering and component bands. The ghost
  //      nodes let multi-column wires bend through the gaps between real nodes
  //      instead of crossing over them, which also reduces wire crossings. ----
  function layout(){
    // drop ghost nodes left over from a previous layout pass
    for (var gk in nodeById){ if (nodeById[gk].virtual) delete nodeById[gk]; }

    // node-level adjacency for components/layering
    var adjU = {};
    nodes.forEach(function(n){ adjU[n.id] = []; });
    edges.forEach(function(e){
      if (e.from === e.to) return;
      adjU[e.from].push(e.to); adjU[e.to].push(e.from);
    });

    // connected components
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

    // longest-path layering
    var layer = {};
    nodes.forEach(function(n){ layer[n.id] = 0; });
    for (var it = 0; it < nodes.length; it++){
      var changed = false;
      edges.forEach(function(e){
        if (e.from === e.to) return;
        if (layer[e.to] < layer[e.from] + 1){
          layer[e.to] = layer[e.from] + 1; changed = true;
        }
      });
      if (!changed) break;
    }

    // ghost waypoints: an edge spanning N columns gets N-1 invisible nodes so
    // it bends through the gaps between real nodes of each intermediate column.
    var ghosts = [], vc = 0;
    routes = edges.map(function(e){
      var l1 = layer[e.from], l2 = layer[e.to], through = [];
      if (l2 - l1 > 1){
        for (var L = l1 + 1; L < l2; L++){
          var id = "_v" + (vc++);
          var gn = { id: id, virtual: true, comp: comp[e.from], vlayer: L,
                     w: 0, h: DUMMY_H, x: 0, y: 0 };
          ghosts.push(gn); nodeById[id] = gn;
          through.push(id);
        }
      }
      return [e.from].concat(through, [e.to]);
    });

    function lOf(n){ return n.virtual ? n.vlayer : layer[n.id]; }
    function cOf(n){ return n.virtual ? n.comp : comp[n.id]; }

    // segment adjacency over the expanded graph (real + ghost nodes)
    var segIn = {}, segOut = {};
    function ensure(id){ if (!segIn[id]) segIn[id] = []; if (!segOut[id]) segOut[id] = []; }
    nodes.forEach(function(n){ ensure(n.id); });
    ghosts.forEach(function(n){ ensure(n.id); });
    routes.forEach(function(r){
      for (var i = 0; i < r.length - 1; i++){
        segOut[r[i]].push(r[i+1]); segIn[r[i+1]].push(r[i]);
      }
    });

    // group every item (real + ghost) by column
    var items = nodes.concat(ghosts);
    var layers = {}, maxL = 0;
    items.forEach(function(n){
      var L = lOf(n);
      (layers[L] = layers[L] || []).push(n);
      if (L > maxL) maxL = L;
    });

    // barycenter ordering to reduce crossings (keep components grouped)
    function posIndex(arr){ var m={}; arr.forEach(function(n,i){ m[n.id]=i; }); return m; }
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
      (layers[L0] || []).sort(function(a,b){ return cOf(a) - cOf(b); });
    for (var pass = 0; pass < 6; pass++){
      for (var L = 1; L <= maxL; L++)
        orderBy(layers[L] || [], segIn, posIndex(layers[L-1] || []));
      for (var L2 = maxL - 1; L2 >= 0; L2--)
        orderBy(layers[L2] || [], segOut, posIndex(layers[L2+1] || []));
    }
    for (var L3 = 0; L3 <= maxL; L3++)
      (layers[L3] || []).forEach(function(n,i){ n._oi = i; });

    // column x positions: cumulative, respecting the widest node per column
    var colW = [];
    for (var L4 = 0; L4 <= maxL; L4++){
      var w = 0;
      (layers[L4] || []).forEach(function(n){ if (n.w > w) w = n.w; });
      colW[L4] = w || 60;
    }
    var colX = [], acc = 0;
    for (var L5 = 0; L5 <= maxL; L5++){
      colX[L5] = acc + colW[L5] / 2;
      acc += colW[L5] + LAYER_GAP;
    }

    // y positions: stack each component's columns (real + ghost) within a band
    var byComp = {};
    items.forEach(function(n){
      var c = cOf(n), L = lOf(n);
      (byComp[c] = byComp[c] || {});
      (byComp[c][L] = byComp[c][L] || []).push(n);
    });
    var compIds = Object.keys(byComp).map(Number).sort(function(a,b){ return a-b; });
    var cursorY = 0;
    compIds.forEach(function(c){
      var cl = byComp[c], bandH = 0;
      for (var L in cl){
        cl[L].sort(function(a,b){ return a._oi - b._oi; });
        var hsum = 0;
        cl[L].forEach(function(n){ hsum += n.h; });
        hsum += (cl[L].length - 1) * NODE_VGAP;
        if (hsum > bandH) bandH = hsum;
      }
      var center = cursorY + bandH / 2;
      for (var L6 in cl){
        var arr = cl[L6], total = 0;
        arr.forEach(function(n){ total += n.h; });
        total += (arr.length - 1) * NODE_VGAP;
        var y = center - total / 2;
        arr.forEach(function(n){
          n.x = colX[Number(L6)];
          n.y = y + n.h / 2;
          y += n.h + NODE_VGAP;
        });
      }
      cursorY += bandH + COMPONENT_GAP;
    });
  }

  // ---- SVG helpers ----
  function el(name, attrs){
    var e = document.createElementNS(SVG_NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function headerPath(w, h, hh, r){
    var x = -w/2, y = -h/2;
    return "M " + (x+r) + " " + y +
      " h " + (w-2*r) + " a " + r + " " + r + " 0 0 1 " + r + " " + r +
      " v " + (hh-r) + " h " + (-w) + " v " + (-(hh-r)) +
      " a " + r + " " + r + " 0 0 1 " + r + " " + (-r) + " z";
  }
  // Width of the chip pill around a constant (text measured at its own size).
  function chipWidth(text){ return tw(text, "700", 10) + 12; }

  // A colored pill around a fixed value, so constants stand out from names.
  function drawChip(g, x, cy, text, color){
    var w = chipWidth(text), h = 14;
    g.appendChild(el("rect", {
      x: x, y: cy - h/2, width: w, height: h, rx: 4, ry: 4, fill: color
    }));
    var t = el("text", { "class": "chip-text", x: x + w/2, y: cy });
    t.textContent = text;
    g.appendChild(t);
    return w;
  }

  var edgeEls = [], nodeEls = [], labelLayer = null;

  // A floating pill (dark bg, colored text) used to reveal a signal name on
  // hover. Lives in the top label layer, never intercepts pointer events.
  // 'segments' (optional) is a list of {text,color} parts so a formula can show
  // each cable name in its own color; 'color' is then the border/fallback.
  function makeLabel(x, y, text, color, anchor, segments){
    var pad = 6, h = 16, w = tw(text, "600", 10.5) + pad * 2;
    var lx = anchor === "end" ? x - w : anchor === "start" ? x : x - w/2;
    var g = el("g", {});
    g.setAttribute("pointer-events", "none");
    g.appendChild(el("rect", {
      x: lx, y: y - h/2, width: w, height: h, rx: 5, ry: 5,
      fill: "#0c0c0e", "fill-opacity": 0.94, stroke: color,
      "stroke-opacity": 0.85, "stroke-width": 1
    }));
    var t = el("text", { "class": "wire-label", x: lx + pad, y: y, fill: color, "xml:space": "preserve" });
    t.style.textAnchor = "start"; // override the stylesheet's centered anchor
    if (segments){
      segments.forEach(function(s){
        var ts = el("tspan", { fill: s.color });
        ts.textContent = s.text;
        t.appendChild(ts);
      });
    } else {
      t.textContent = text;
    }
    g.appendChild(t);
    return g;
  }

  // Splits an expression into colored parts: each operand (cable/register) gets
  // its signal color from colorByName; operators, parentheses, constants and
  // whitespace keep the neutral 'def' color.
  function colorSegments(text, colorByName, def){
    var segs = [], re = /_?[A-Za-z][A-Za-z0-9_.]*/g, last = 0, m;
    while ((m = re.exec(text))){
      if (m.index > last) segs.push({ text: text.slice(last, m.index), color: def });
      segs.push({ text: m[0], color: colorByName[m[0]] || def });
      last = m.index + m[0].length;
    }
    if (last < text.length) segs.push({ text: text.slice(last), color: def });
    return segs;
  }
  function clearLabels(){
    if (labelLayer) while (labelLayer.firstChild) labelLayer.removeChild(labelLayer.firstChild);
  }

  // ---- hover tooltip: documented label + description of an I/O/control jack,
  //      taken from the file's Forge label legend (only when present) ----
  function esc(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  function showTooltip(n, ev){
    if (!n.flabel && !n.fdesc) return;
    var html = "";
    if (n.flabel)
      html += '<span class="tt-label">' + esc(n.flabel) + '</span>' +
              '<span class="tt-reg">' + esc(n.label) + '</span>';
    else
      html += '<span class="tt-reg" style="margin-left:0">' + esc(n.label) + '</span>';
    if (n.fdesc) html += '<div class="tt-desc">' + esc(n.fdesc) + '</div>';
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    moveTooltip(ev);
  }
  function moveTooltip(ev){
    var r = tooltip.getBoundingClientRect();
    var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > window.innerWidth) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight) y = ev.clientY - r.height - 14;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }
  function hideTooltip(){ tooltip.style.display = "none"; }
  // The text written in an input row (its operand expression), looked up by pin
  // id "i:<key>:<idx>". For a parenthesized formula this is the whole expression
  // (e.g. "(_A + _B) * _C"), so the hover can show it as a single readable unit.
  function inputRowText(n, pinId){
    if (pinId.charAt(0) !== "i") return null;
    var rest = pinId.slice(2), ci = rest.lastIndexOf(":");
    if (ci < 0) return null;
    var key = rest.slice(0, ci), idx = +rest.slice(ci + 1);
    var pins = n.inputs || [];
    for (var i = 0; i < pins.length; i++){
      if (pins[i].key === key){
        var r = pins[i].rows[idx];
        return r ? r.text : null;
      }
    }
    return null;
  }

  // Reveal the names of every cable touching a circuit, placed just outside the
  // relevant pin (in the gutter where the wire runs). One pill per pin: for an
  // input pin we show the row's full expression (so a parenthesized formula
  // reads as one unit with its cable names, instead of overlapping pills).
  function labelNode(n){
    if (n.kind !== "circuit" || !labelLayer) return;
    // Collect the signals on each pin (name -> color) and the first color seen.
    var inPins = {}, outPins = {};
    (incident[n.id] || []).forEach(function(ee){
      var e = ee.data;
      if (e.to === n.id && n.pins[e.toPin]){
        var gi = inPins[e.toPin] || (inPins[e.toPin] = { colors: {}, first: e.color });
        if (!(e.label in gi.colors)) gi.colors[e.label] = e.color;
      }
      if (e.from === n.id && n.pins[e.fromPin] && !outPins[e.fromPin]){
        outPins[e.fromPin] = e;
      }
    });
    for (var pinId in inPins){
      var p = n.pins[pinId], grp = inPins[pinId];
      var text = inputRowText(n, pinId);
      var x = n.x + p.x - PIN_R - 4, y = n.y + p.y;
      if (text){
        var segs = colorSegments(text, grp.colors, "#cfcfcf");
        labelLayer.appendChild(makeLabel(x, y, text, grp.first, "end", segs));
      } else {
        labelLayer.appendChild(makeLabel(x, y, "?", grp.first, "end"));
      }
    }
    for (var oPin in outPins){
      var e2 = outPins[oPin], q = n.pins[oPin];
      labelLayer.appendChild(
        makeLabel(n.x + q.x + PIN_R + 4, n.y + q.y, e2.label, e2.color, "start"));
    }
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
        "stroke-width": 2, "stroke-opacity": 0.7
      });
      edgeLayer.appendChild(path);
      var rec = { data: e, path: path, route: routes[i] };
      edgeEls.push(rec);
      incident[e.from].push(rec); incident[e.to].push(rec);
      attachWireHover(rec);
    });

    var nodeLayer = el("g", {});
    viewport.appendChild(nodeLayer);
    nodes.forEach(function(n){
      var g = el("g", { "class": "node" });
      // Native <title> as a fallback, except where a richer custom tooltip
      // (the documented label/description) will take over, to avoid doubling.
      if (!n.flabel && !n.fdesc){
        var title = el("title", {});
        title.textContent = n.title || n.label || n.name;
        g.appendChild(title);
      }
      if (n.kind === "circuit") renderCircuit(g, n);
      else renderHardware(g, n);
      attachInteraction(g, n);
      nodeLayer.appendChild(g);
      var rec = { data: n, g: g };
      nodeEls.push(rec);
      n._el = rec;
    });

    labelLayer = el("g", {}); // on-hover signal names, always on top
    viewport.appendChild(labelLayer);

    paint();
    document.getElementById("count").textContent =
      nodes.length + " nodes, " + edges.length + " wires";
  }

  function renderCircuit(g, n){
    g.appendChild(el("rect", {
      "class": "node-body", x: -n.w/2, y: -n.h/2, width: n.w, height: n.h,
      rx: 6, ry: 6, fill: "#1b1b1d"
    }));
    g.appendChild(el("path", {
      d: headerPath(n.w, n.h, HEADER_H, 6), fill: n.color, "fill-opacity": 0.95
    }));
    var ht = el("text", { "class": "header-text", x: -n.w/2 + PAD_X, y: -n.h/2 + HEADER_H/2 });
    ht.textContent = n.name;
    g.appendChild(ht);

    n._left.forEach(function(r){
      // Formula signal rows have no border pin: instead the wire runs straight
      // into the inline dot (a short lead, drawn behind the row's text).
      if (r.dotX != null){
        // The wire's lead inside the card: dimmed so it reads as "already
        // arrived" and does not compete with the wires running between nodes.
        g.appendChild(el("line", {
          x1: -n.w/2, y1: r.y, x2: -n.w/2 + r.dotX, y2: r.y,
          stroke: r.color, "stroke-width": 2, "stroke-opacity": 0.3
        }));
      } else if (r.conn){
        g.appendChild(el("circle", {
          cx: -n.w/2, cy: r.y, r: PIN_R, fill: r.color,
          stroke: "#0a0a0a", "stroke-width": 1
        }));
      }
      var x = -n.w/2 + PAD_X;
      // Keep the wire lead from striking through the assignment label.
      if (r.parts && r.base){
        g.appendChild(el("rect", {
          x: x - PART_GAP, y: r.y - ROW_H/2,
          width: r.headSpace - HEAD_GAP/2 + PART_GAP, height: ROW_H,
          fill: "#1b1b1d"
        }));
      }
      // head: the pin name (base row) or the operator glyph (modifier row)
      var head = el("text", {
        "class": r.base ? "pin-name pin-base" : "pin-name pin-op",
        x: x, y: r.y, "text-anchor": "start"
      });
      head.textContent = r.head;
      g.appendChild(head);
      if (r.parts){
        // Formula row: parens (neutral), a colored dot per signal, chip per
        // constant. Start after the assignment label on the base row, or after
        // the aligned operator on continuation rows.
        x = -n.w/2 + PAD_X + r.headSpace;
        r.parts.forEach(function(p, i){
          if (i) x += PART_GAP;
          if (p.t === "paren"){
            var pt = el("text", {
              "class": "pin-name", x: x, y: r.y, "text-anchor": "start"
            });
            pt.style.fontWeight = "800"; // bold parens so the grouping stands out
            pt.style.fill = "#e8e8e8";
            pt.textContent = p.s;
            g.appendChild(pt);
            x += p.w;
          } else if (p.t === "dot"){
            g.appendChild(el("circle", {
              cx: x + PIN_R, cy: r.y, r: PIN_R, fill: p.color,
              stroke: "#0a0a0a", "stroke-width": 1
            }));
            x += p.w;
          } else { // chip (constant)
            x += drawChip(g, x, r.y, p.s, p.color);
          }
        });
      } else if (r.operand){
        // operand: a colored chip for constants, plain text for shown signals
        x += r.headW + HEAD_GAP;
        if (r.conn){
          var ot = el("text", {
            "class": "pin-name pin-sub", x: x, y: r.y, "text-anchor": "start"
          });
          ot.textContent = r.operand;
          g.appendChild(ot);
        } else {
          drawChip(g, x, r.y, r.operand, r.color);
        }
      }
    });

    n._right.forEach(function(r){
      if (r.conn){
        g.appendChild(el("circle", {
          cx: n.w/2, cy: r.y, r: PIN_R, fill: r.color,
          stroke: "#0a0a0a", "stroke-width": 1
        }));
      }
      // right-align the whole name(+operand) group against the output pin
      var x = n.w/2 - PAD_X - r.width;
      var nm = el("text", {
        "class": "pin-name pin-base", x: x, y: r.y, "text-anchor": "start"
      });
      nm.textContent = r.name;
      g.appendChild(nm);
      if (r.operand){
        x += r.nameW + HEAD_GAP;
        if (r.conn){
          var ot = el("text", {
            "class": "pin-name pin-sub", x: x, y: r.y, "text-anchor": "start"
          });
          ot.textContent = r.operand;
          g.appendChild(ot);
        } else {
          drawChip(g, x, r.y, r.operand, r.color);
        }
      }
    });
  }

  function renderHardware(g, n){
    g.appendChild(el("rect", {
      "class": "node-body hw-body", x: -n.w/2, y: -n.h/2,
      width: n.w, height: n.h, rx: n.h/2, ry: n.h/2,
      fill: "#202022", stroke: n.hwColor
    }));
    var t = el("text", { "class": "hw-label", x: 0, y: 0, fill: n.hwColor });
    t.textContent = n.label;
    g.appendChild(t);
    var p = n.pins["p"];
    g.appendChild(el("circle", {
      cx: p.x, cy: p.y, r: PIN_R, fill: n.hwColor,
      stroke: "#0a0a0a", "stroke-width": 1
    }));
  }

  // Absolute points of a cable: its two pin endpoints plus the ghost waypoints.
  function edgePoints(e, route){
    var first = nodeById[route[0]], last = nodeById[route[route.length - 1]];
    var pa = first.pins && first.pins[e.fromPin];
    var pb = last.pins && last.pins[e.toPin];
    if (!pa || !pb) return null;
    var pts = [{ x: first.x + pa.x, y: first.y + pa.y }];
    for (var i = 1; i < route.length - 1; i++){
      var d = nodeById[route[i]];
      pts.push({ x: d.x, y: d.y });
    }
    pts.push({ x: last.x + pb.x, y: last.y + pb.y });
    return pts;
  }
  // Smooth left-to-right path through the points; horizontal tangents at each
  // give the flowing Unreal-style cable through the ghost waypoints.
  function edgePath(pts){
    var path = "M " + pts[0].x + " " + pts[0].y;
    for (var j = 1; j < pts.length; j++){
      var A = pts[j-1], B = pts[j], mx = (A.x + B.x) / 2;
      path += " C " + mx + " " + A.y + " " + mx + " " + B.y + " " +
              B.x + " " + B.y;
    }
    return path;
  }
  // Midpoint along the route, for placing a hovered cable's label.
  function edgeMid(pts){
    if (pts.length % 2 === 1) return pts[(pts.length - 1) / 2];
    var a = pts[pts.length/2 - 1], b = pts[pts.length/2];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function paint(){
    nodeEls.forEach(function(ne){
      ne.g.setAttribute("transform",
        "translate(" + ne.data.x + "," + ne.data.y + ")");
    });
    edgeEls.forEach(function(ee){
      var pts = edgePoints(ee.data, ee.route);
      if (pts) ee.path.setAttribute("d", edgePath(pts));
    });
  }

  // ---- hover highlight ----
  function highlight(node){
    var keep = {}; keep[node.id] = true;
    var inc = incident[node.id] || [];
    inc.forEach(function(ee){ keep[ee.data.from] = true; keep[ee.data.to] = true; });
    edgeEls.forEach(function(ee){
      var on = inc.indexOf(ee) >= 0;
      ee.path.setAttribute("stroke-opacity", on ? 1 : 0.06);
      ee.path.setAttribute("stroke-width", on ? 3 : 2);
    });
    nodeEls.forEach(function(ne){ ne.g.style.opacity = keep[ne.data.id] ? 1 : 0.25; });
  }
  function clearHighlight(){
    edgeEls.forEach(function(ee){
      ee.path.setAttribute("stroke-opacity", 0.7);
      ee.path.setAttribute("stroke-width", 2);
    });
    nodeEls.forEach(function(ne){ ne.g.style.opacity = 1; });
  }

  // Emphasize a single cable and float its name at the route midpoint.
  function attachWireHover(rec){
    rec.path.addEventListener("mouseenter", function(){
      rec.path.setAttribute("stroke-opacity", 1);
      rec.path.setAttribute("stroke-width", 3.5);
      var pts = edgePoints(rec.data, rec.route);
      if (pts && labelLayer){
        var m = edgeMid(pts);
        labelLayer.appendChild(makeLabel(m.x, m.y, rec.data.label, rec.data.color, "mid"));
      }
    });
    rec.path.addEventListener("mouseleave", function(){
      rec.path.setAttribute("stroke-opacity", 0.7);
      rec.path.setAttribute("stroke-width", 2);
      clearLabels();
    });
  }

  // ---- interaction: hover, drag, click-to-reveal ----
  function attachInteraction(g, n){
    g.addEventListener("mouseenter", function(ev){ highlight(n); labelNode(n); showTooltip(n, ev); });
    g.addEventListener("mousemove", function(ev){
      if (tooltip.style.display === "block") moveTooltip(ev);
    });
    g.addEventListener("mouseleave", function(){ clearHighlight(); clearLabels(); hideTooltip(); });
    g.addEventListener("pointerdown", function(ev){
      ev.stopPropagation();
      clearLabels(); hideTooltip();
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

  // pan with background drag
  var panning = false, panStart = null;
  svg.addEventListener("pointerdown", function(ev){
    panning = true;
    hideTooltip();
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

  // Trackpad/wheel: pinch (reported as ctrl+wheel) zooms centered on the
  // cursor; a plain two-finger scroll pans, following the gesture in both axes.
  svg.addEventListener("wheel", function(ev){
    ev.preventDefault();
    if (ev.ctrlKey){
      var rect = svg.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var factor = Math.pow(1.01, -ev.deltaY);
      var ns = Math.min(4, Math.max(0.1, scale * factor));
      tx = mx - (mx - tx) * (ns / scale);
      ty = my - (my - ty) * (ns / scale);
      scale = ns;
    } else {
      tx -= ev.deltaX;
      ty -= ev.deltaY;
    }
    applyTransform();
  }, { passive: false });

  function fit(){
    if (!nodes.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function(n){
      minX = Math.min(minX, n.x - n.w/2); maxX = Math.max(maxX, n.x + n.w/2);
      minY = Math.min(minY, n.y - n.h/2); maxY = Math.max(maxY, n.y + n.h/2);
    });
    var w = maxX - minX, h = maxY - minY;
    var vw = svg.clientWidth, vh = svg.clientHeight;
    scale = Math.min(1.5, Math.max(0.1, Math.min(vw/(w+120), vh/(h+120))));
    tx = (vw - w*scale)/2 - minX*scale;
    ty = (vh - h*scale)/2 - minY*scale;
    applyTransform();
  }

  toggleHw.addEventListener("change", buildScene);
  document.getElementById("relayout").addEventListener("click", function(){
    layout(); render(); fit();
  });
  document.getElementById("fit").addEventListener("click", fit);

  buildScene();
})();
`;
