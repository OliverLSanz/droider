// Context-aware autocompletion:
//   - inside [ ...    -> circuit names (and controllers)
//   - start of line in a known circuit -> its inputs/outputs
//   - right-hand side of '=' -> registers (master + controllers) and cables in use

import * as vscode from "vscode";
import { DroidData } from "./data";
import { cablesInDocument, cablesUsedAsOutputs, contextAtLine, paramsUsedInBlock } from "./context";
import { LabelSection, labelSectionAtLine } from "./labels";

const HEADER_TYPING_RE = /^\s*\[[a-z0-9]*$/;
// We are typing the register of a label entry: "#  I", "#  S1." ...
const LABEL_ENTRY_TYPING_RE = /^#\s+[A-Za-z0-9.]*$/;

export class DroidCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private data: DroidData) {}

  provideCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const before = doc.lineAt(pos.line).text.slice(0, pos.character);

    // --- Label entry inside a legend section ---
    if (LABEL_ENTRY_TYPING_RE.test(before)) {
      const lines = doc.getText().split(/\r?\n/);
      const section = labelSectionAtLine(lines, pos.line);
      if (section) {
        return this.labelRegisterCompletions(
          section,
          this.data.controllerChain(lines)
        );
      }
    }

    // --- Header: [circuit] / [controller] ---
    if (HEADER_TYPING_RE.test(before)) {
      return this.headerCompletions(doc, pos);
    }

    const ctx = contextAtLine(doc, pos.line, this.data);
    const eq = doc.lineAt(pos.line).text.indexOf("=");

    // --- Right-hand side of '=': registers and cables ---
    if (eq >= 0 && pos.character > eq) {
      const afterEq = before.slice(eq + 1).trimStart();
      const typingCable = afterEq.startsWith("_");

      const rawParam = before.slice(0, eq).trim().toLowerCase();
      const base = rawParam.replace(/\d+$/, "");
      const circuit = ctx.circuit ? this.data.circuits.get(ctx.circuit) : null;
      const isOutputParam =
        circuit?.outputs?.some((o) => o.name === rawParam || o.name === base) ??
        false;

      return this.valueCompletions(doc, pos, ctx.chain, isOutputParam, typingCable);
    }

    // --- Parameter name inside a known circuit ---
    if (ctx.circuit) {
      return this.parameterCompletions(ctx.circuit, paramsUsedInBlock(doc, pos.line));
    }
    return undefined;
  }

  private headerCompletions(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const line = doc.lineAt(pos.line).text;
    const after = line.slice(pos.character);
    // Check if there's already a closing bracket (from autoClosingPairs)
    const closingBracketMatch = after.match(/^(\s*)\]/);
    const hasClosingBracket = closingBracketMatch !== null;

    for (const c of this.data.circuits.values()) {
      const it = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Class);
      it.detail = c.title;
      it.documentation = new vscode.MarkdownString(c.description);
      it.insertText = new vscode.SnippetString(`${c.name}]\n    $0`);
      
      // If there's an auto-closing bracket, extend the range to replace it
      if (hasClosingBracket) {
        const endPos = pos.translate(0, closingBracketMatch![0].length);
        it.range = new vscode.Range(pos, endPos);
      }
      
      // Trigger suggestions after insertion
      it.command = {
        command: "editor.action.triggerSuggest",
        title: "Trigger Suggestions"
      };
      items.push(it);
    }
    for (const c of this.data.controllers.values()) {
      const it = new vscode.CompletionItem(c.type, vscode.CompletionItemKind.Module);
      it.detail = `Controller · ${c.title}`;
      it.documentation = new vscode.MarkdownString(c.description);
      it.insertText = new vscode.SnippetString(`${c.type}]\n    $0`);
      
      // If there's an auto-closing bracket, extend the range to replace it
      if (hasClosingBracket) {
        const endPos = pos.translate(0, closingBracketMatch![0].length);
        it.range = new vscode.Range(pos, endPos);
      }
      
      // Trigger suggestions after insertion
      it.command = {
        command: "editor.action.triggerSuggest",
        title: "Trigger Suggestions"
      };
      items.push(it);
    }
    return items;
  }

  private parameterCompletions(
    circuitName: string,
    used: Set<string>
  ): vscode.CompletionItem[] {
    const circuit = this.data.circuits.get(circuitName);
    if (!circuit) return [];
    const items: vscode.CompletionItem[] = [];
    const make = (params: typeof circuit.inputs, role: "input" | "output") => {
      for (const p of params ?? []) {
        if (!p.array) {
          if (used.has(p.name)) continue;
        } else {
          // Array param: only hide if every numbered slot is already used.
          const allUsed = Array.from(
            { length: p.array },
            (_, i) => `${p.name}${i + 1}`
          ).every((slot) => used.has(slot));
          if (allUsed) continue;
        }
        const it = new vscode.CompletionItem(
          p.name,
          role === "input"
            ? vscode.CompletionItemKind.Field
            : vscode.CompletionItemKind.Property
        );
        const abbr = p.abbr ? ` · abbr: ${p.abbr}` : "";
        const def = p.default !== undefined ? ` · def: ${p.default}` : "";
        it.detail = `${role}${p.valuetype ? " " + p.valuetype : ""}${abbr}${def}`;
        it.documentation = new vscode.MarkdownString(p.description);
        it.insertText = `${p.name} = `;
        items.push(it);
      }
    };
    make(circuit.inputs, "input");
    make(circuit.outputs, "output");
    return items;
  }

  private labelRegisterCompletions(
    section: LabelSection,
    chain: string[]
  ): vscode.CompletionItem[] {
    const controllerRe = new RegExp(`^[A-Za-z]+${section.controller}\\.`);
    const matches = (name: string): boolean => {
      if (section.kind === "inputs") return /^I\d+$/.test(name);
      if (section.kind === "outputs") return /^O\d+$/.test(name);
      return controllerRe.test(name);
    };
    const items: vscode.CompletionItem[] = [];
    for (const [name, info] of this.data.validRegisters(chain)) {
      if (!matches(name)) continue;
      const it = new vscode.CompletionItem(
        name,
        vscode.CompletionItemKind.Constant
      );
      it.detail = `register · ${info.direction}`;
      it.documentation = new vscode.MarkdownString(info.description);
      it.insertText = new vscode.SnippetString(`${name}: [$1] $0`);
      items.push(it);
    }
    return items;
  }

  private valueCompletions(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    chain: string[],
    isOutputParam: boolean,
    cableOnly = false
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    if (!cableOnly) {
      for (const [name, info] of this.data.validRegisters(chain)) {
        const it = new vscode.CompletionItem(
          name,
          vscode.CompletionItemKind.Constant
        );
        it.detail = `register · ${info.direction}${
          info.valuetype ? " · " + info.valuetype : ""
        }`;
        it.documentation = new vscode.MarkdownString(info.description);
        items.push(it);
      }
    }

    // When on an output parameter, exclude cables already taken by another output.
    const usedAsOutput = isOutputParam
      ? cablesUsedAsOutputs(doc, this.data, pos.line)
      : new Set<string>();

    for (const cable of cablesInDocument(doc)) {
      if (usedAsOutput.has(cable)) continue;
      const it = new vscode.CompletionItem(
        cable,
        vscode.CompletionItemKind.Variable
      );
      it.detail = "internal cable";
      items.push(it);
    }

    return items;
  }
}
