// Hover (documentation on mouse-over):
//   - over the [circuit] header -> circuit title + description
//   - over a parameter name     -> type, default, range and description
//   - over a register           -> direction and description
//   - over an internal cable    -> note + number of occurrences

import * as vscode from "vscode";
import { DroidData, ParamSpec } from "./data";
import { contextAtLine } from "./context";

// Captures register/cable/identifier-like tokens, including dots (P3.2).
const WORD_RE = /[A-Za-z_][A-Za-z0-9_.]*/;
const HEADER_RE = /^(\s*\[)([a-z0-9]+)(\])\s*$/;

export class DroidHoverProvider implements vscode.HoverProvider {
  constructor(private data: DroidData) {}

  provideHover(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.Hover | undefined {
    const lineText = doc.lineAt(pos.line).text;

    // --- Circuit / controller header ---
    const hm = lineText.match(HEADER_RE);
    if (hm) {
      const name = hm[2];
      const nameStart = hm[1].length;
      if (pos.character >= nameStart && pos.character <= nameStart + name.length) {
        return this.headerHover(name);
      }
    }

    const range = doc.getWordRangeAtPosition(pos, WORD_RE);
    if (!range) return undefined;
    const word = doc.getText(range);

    const eq = lineText.indexOf("=");
    const onName = eq < 0 || range.end.character <= eq;

    const ctx = contextAtLine(doc, pos.line, this.data);

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
