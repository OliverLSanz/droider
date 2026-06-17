// Hover (documentation on mouse-over):
//   - over the [circuit] header -> circuit title + description
//   - over a parameter name     -> type, default, range and description
//   - over a register           -> direction and description
//   - over an internal cable    -> note + number of occurrences

import * as vscode from "vscode";
import { DroidData, ParamSpec } from "./data";
import { contextAtLine, currentBlockHeader } from "./context";
import { BlueprintRegistry } from "./blueprintRegistry";
import { Blueprint } from "./blueprints";
import { modeForLanguageId } from "./linter";

// Captures register/cable/identifier-like tokens, including dots (P3.2).
const WORD_RE = /[A-Za-z_][A-Za-z0-9_.]*/;
const HEADER_RE = /^(\s*\[)([a-z0-9]+)(\])\s*$/;

export class DroidHoverProvider implements vscode.HoverProvider {
  constructor(private data: DroidData, private registry: BlueprintRegistry) {}

  provideHover(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.Hover | undefined {
    const lineText = doc.lineAt(pos.line).text;
    const mode = modeForLanguageId(doc.languageId);
    const sugar = mode !== "ini";

    // --- Circuit / controller / megacircuit header ---
    const hm = lineText.match(HEADER_RE);
    if (hm) {
      const name = hm[2];
      const nameStart = hm[1].length;
      if (pos.character >= nameStart && pos.character <= nameStart + name.length) {
        const bp = sugar ? this.registry.all().get(name) : undefined;
        if (bp) return this.blueprintHover(bp);
        return this.headerHover(name);
      }
    }

    const range = doc.getWordRangeAtPosition(pos, WORD_RE);
    if (!range) return undefined;
    const word = doc.getText(range);

    const eq = lineText.indexOf("=");
    const onName = eq < 0 || range.end.character <= eq;

    const ctx = contextAtLine(doc, pos.line, this.data);

    // --- Megacircuit instance port (left of '=') ---
    if (sugar) {
      const header = currentBlockHeader(doc, pos.line);
      const bp = header ? this.registry.all().get(header) : undefined;
      if (bp && onName) {
        const port =
          bp.inputs.find((p) => p.name === word) ??
          bp.outputs.find((p) => p.name === word);
        if (port) {
          const role = bp.inputs.includes(port) ? "input" : "output";
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`**${port.name}** · megacircuit _${role}_ of \`${bp.name}\``);
          if (port.default !== undefined) md.appendMarkdown(` · default \`${port.default}\``);
          if (port.doc) md.appendMarkdown(`\n\n${port.doc}`);
          return new vscode.Hover(md, range);
        }
      }
    }

    // --- Parameter name (left of '=') ---
    if (onName && ctx.circuit) {
      const found = this.data.paramLookup(ctx.circuit, word);
      if (found) return new vscode.Hover(this.paramMarkdown(found.role, found.spec), range);
      return undefined;
    }

    // --- Value (right of '='): cable or register ---
    if (!onName) {
      if (word.startsWith("_")) {
        return new vscode.Hover(this.cableMarkdown(doc, word), range);
      }
      const info = this.data.registerInfo(word, ctx.chain);
      if (info) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${word}** · register · _${info.direction}_`);
        if (info.valuetype) md.appendMarkdown(` · \`${info.valuetype}\``);
        md.appendMarkdown(`\n\n${info.description}`);
        return new vscode.Hover(md, range);
      }
    }
    return undefined;
  }

  private blueprintHover(bp: Blueprint): vscode.Hover {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**[${bp.name}]** — megacircuit (blueprint)\n\n`);
    if (bp.doc) md.appendMarkdown(`${bp.doc}\n\n`);
    const fmt = (p: { name: string; default?: string }) =>
      p.default !== undefined ? `${p.name} (=${p.default})` : p.name;
    md.appendMarkdown(`**inputs:** ${bp.inputs.map(fmt).join(", ") || "—"}\n\n`);
    md.appendMarkdown(`**outputs:** ${bp.outputs.map((p) => p.name).join(", ") || "—"}`);
    return new vscode.Hover(md);
  }

  private headerHover(name: string): vscode.Hover {
    const circuit = this.data.circuits.get(name);
    if (circuit) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${circuit.name}** — ${circuit.title}\n\n`);
      md.appendMarkdown(circuit.description);
      return new vscode.Hover(md);
    }
    const ctrl = this.data.controllers.get(name);
    if (ctrl) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**[${ctrl.type}]** — ${ctrl.title} controller\n\n`);
      md.appendMarkdown(ctrl.description);
      return new vscode.Hover(md);
    }
    const md = new vscode.MarkdownString(
      `**[${name}]** — unknown circuit (not yet extracted to YAML).`
    );
    return new vscode.Hover(md);
  }

  private paramMarkdown(role: string, spec: ParamSpec): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${spec.name}** · _${role}_`);
    if (spec.abbr) md.appendMarkdown(` · abbr \`${spec.abbr}\``);
    if (spec.valuetype) md.appendMarkdown(` · \`${spec.valuetype}\``);
    md.appendMarkdown("\n\n");
    const facts: string[] = [];
    if (spec.default !== undefined) facts.push(`default: \`${spec.default}\``);
    if (spec.min !== undefined && spec.max !== undefined)
      facts.push(`range: \`${spec.min}…${spec.max}\``);
    if (spec.unit) facts.push(`unit: ${spec.unit}`);
    if (facts.length) md.appendMarkdown(facts.join(" · ") + "\n\n");
    md.appendMarkdown(spec.description);
    return md;
  }

  private cableMarkdown(
    doc: vscode.TextDocument,
    cable: string
  ): vscode.MarkdownString {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(cable)}([^A-Za-z0-9_]|$)`);
    let count = 0;
    for (let i = 0; i < doc.lineCount; i++) {
      const code = doc.lineAt(i).text.split("#")[0];
      if (re.test(code)) count++;
    }
    return new vscode.MarkdownString(
      `**${cable}** — internal cable.\n\nAppears in ${count} line(s).`
    );
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
