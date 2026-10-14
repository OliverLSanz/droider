// Context-aware autocompletion:
//   - inside [ ...    -> circuit names (and controllers)
//   - start of line in a known circuit -> its inputs/outputs
//   - right-hand side of '=' -> registers (master + controllers) and cables in use

import * as vscode from "vscode";
import { DroidData, ParamSpec } from "./data";
import { cablesInDocument, cablesUsedAsOutputs, contextAtLine, currentBlockHeader, paramsUsedInBlock } from "./context";
import { LabelSection, labelSectionAtLine } from "./labels";
import { BlueprintRegistry } from "./blueprintRegistry";
import { Blueprint, parseBlueprint } from "./blueprints";
import { modeForLanguageId, PatchMode } from "./linter";

const HEADER_TYPING_RE = /^\s*\[[a-z0-9]*$/;
// We are typing the register of a label entry: "#  I", "#  S1." ...
const LABEL_ENTRY_TYPING_RE = /^#\s+[A-Za-z0-9.]*$/;

export class DroidCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private data: DroidData, private registry: BlueprintRegistry) {}

  provideCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const before = doc.lineAt(pos.line).text.slice(0, pos.character);
    const mode = modeForLanguageId(doc.languageId);

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

    // --- Header: [circuit] / [controller] / [megacircuit] ---
    if (HEADER_TYPING_RE.test(before)) {
      return this.headerCompletions(doc, pos, mode);
    }

    const ctx = contextAtLine(doc, pos.line, this.data);
    const header = currentBlockHeader(doc, pos.line);
    const bp =
      mode !== "ini" && header ? this.registry.all().get(header) : undefined;
    const eq = doc.lineAt(pos.line).text.indexOf("=");

    // --- Right-hand side of '=': registers and cables ---
    if (eq >= 0 && pos.character > eq) {
      const afterEq = before.slice(eq + 1).trimStart();
      const typingCable = afterEq.startsWith("_");

      const rawParam = before.slice(0, eq).trim().toLowerCase();
      const base = rawParam.replace(/\d+$/, "");
      let isOutputParam: boolean;
      if (bp) {
        isOutputParam = bp.outputs.some((o) => o.name === rawParam);
      } else {
        const circuit = ctx.circuit ? this.data.circuits.get(ctx.circuit) : null;
        isOutputParam =
          circuit?.outputs?.some((o) => o.name === rawParam || o.name === base) ??
          false;
      }

      const items = this.valueCompletions(doc, pos, ctx.chain, isOutputParam, typingCable);
      // In a blueprint body, ports are referenced by name directly in values.
      if (mode === "blueprint" && !typingCable) {
        const def = parseBlueprint(doc.getText(), "");
        for (const p of [...def.inputs, ...def.outputs]) {
          const it = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Variable);
          it.detail = "megacircuit port";
          if (p.doc) it.documentation = new vscode.MarkdownString(p.doc);
          items.push(it);
        }
      }
      return items;
    }

    // --- Parameter / port name inside a known block ---
    if (bp) {
      return this.blueprintPortCompletions(bp, paramsUsedInBlock(doc, pos.line));
    }
    if (ctx.circuit) {
      return this.parameterCompletions(ctx.circuit, paramsUsedInBlock(doc, pos.line));
    }
    return undefined;
  }

  private headerCompletions(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    mode: PatchMode
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const line = doc.lineAt(pos.line).text;
    const after = line.slice(pos.character);
    // Check if there's already a closing bracket (from autoClosingPairs)
    const closingBracketMatch = after.match(/^(\s*)\]/);
    // Include the typed name: VS Code also uses the text from range.start to
    // the cursor to filter suggestions. Starting at the cursor would disable
    // filtering and leave that prefix in place when accepting a completion.
    const range = new vscode.Range(
      new vscode.Position(pos.line, line.indexOf("[") + 1),
      pos.translate(0, closingBracketMatch?.[0].length ?? 0)
    );

    const extendRange = (it: vscode.CompletionItem) => {
      it.range = range;
      it.command = {
        command: "editor.action.triggerSuggest",
        title: "Trigger Suggestions",
      };
    };

    // Megacircuits (blueprints): only in .droider / .blueprint files.
    if (mode !== "ini") {
      for (const bp of this.registry.all().values()) {
        const it = new vscode.CompletionItem(bp.name, vscode.CompletionItemKind.Interface);
        it.detail = "megacircuit";
        const doc = bp.doc ? `${bp.doc}\n\n` : "";
        const io =
          `**inputs:** ${bp.inputs.map((p) => p.name).join(", ") || "—"}\n\n` +
          `**outputs:** ${bp.outputs.map((p) => p.name).join(", ") || "—"}`;
        it.documentation = new vscode.MarkdownString(doc + io);
        // Only required inputs (no default) and outputs go into the snippet;
        // optional inputs can be added by hand.
        const wires = [
          ...bp.inputs.filter((p) => p.default === undefined),
          ...bp.outputs,
        ]
          .map((p, idx) => `    ${p.name} = $${idx + 1}`)
          .join("\n");
        it.insertText = new vscode.SnippetString(`${bp.name}]\n${wires}\n    $0`);
        extendRange(it);
        items.push(it);
      }
    }

    // [input]/[output] sections: only when authoring a blueprint.
    if (mode === "blueprint") {
      for (const section of ["input", "output"] as const) {
        const it = new vscode.CompletionItem(section, vscode.CompletionItemKind.Keyword);
        it.detail = `megacircuit ${section} ports`;
        const hint =
          section === "input"
            ? "Declares input ports, one per line: `name` (required) or `name = default` (optional)."
            : "Declares output ports, one per line: `name`.";
        it.documentation = new vscode.MarkdownString(hint);
        it.insertText = new vscode.SnippetString(`${section}]\n    $0`);
        extendRange(it);
        items.push(it);
      }
    }

    for (const c of this.data.circuits.values()) {
      const it = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Class);
      it.detail = c.title;
      it.documentation = new vscode.MarkdownString(c.description);
      it.insertText = new vscode.SnippetString(`${c.name}]\n    $0`);
      extendRange(it);
      items.push(it);
    }
    for (const c of this.data.controllers.values()) {
      const it = new vscode.CompletionItem(c.type, vscode.CompletionItemKind.Module);
      it.detail = `Controller · ${c.title}`;
      it.documentation = new vscode.MarkdownString(c.description);
      // Controllers/hardware declarations have no indented parameter body, so we
      // just close the bracket and drop to a fresh column-0 line.
      it.insertText = new vscode.SnippetString(`${c.type}]\n$0`);

      it.range = range;

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
      const emit = (label: string, p: ParamSpec) => {
        const it = new vscode.CompletionItem(
          label,
          role === "input"
            ? vscode.CompletionItemKind.Field
            : vscode.CompletionItemKind.Property
        );
        const abbr = p.abbr ? ` · abbr: ${p.abbr}` : "";
        const def = p.default !== undefined ? ` · def: ${p.default}` : "";
        it.detail = `${role}${p.valuetype ? " " + p.valuetype : ""}${abbr}${def}`;
        it.documentation = new vscode.MarkdownString(p.description);
        it.insertText = `${label} = `;
        items.push(it);
      };
      for (const p of params ?? []) {
        if (!p.array) {
          if (used.has(p.name)) continue;
          emit(p.name, p);
        } else {
          // Array param: offer each numbered slot (input1..inputN) that isn't
          // already used. The linter accepts both the numbered slots and the
          // bare base name (an alias for slot 1), so offer the base name too.
          if (!used.has(p.name)) emit(p.name, p);
          for (let i = 1; i <= p.array; i++) {
            const slot = `${p.name}${i}`;
            if (used.has(slot)) continue;
            emit(slot, p);
          }
        }
      }
    };
    make(circuit.inputs, "input");
    make(circuit.outputs, "output");
    return items;
  }

  private blueprintPortCompletions(
    bp: Blueprint,
    used: Set<string>
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const make = (
      ports: typeof bp.inputs,
      role: "input" | "output"
    ) => {
      for (const p of ports) {
        if (used.has(p.name)) continue;
        const it = new vscode.CompletionItem(
          p.name,
          role === "input"
            ? vscode.CompletionItemKind.Field
            : vscode.CompletionItemKind.Property
        );
        const def = p.default !== undefined ? ` · default: ${p.default}` : "";
        it.detail = `megacircuit ${role}${def}`;
        if (p.doc) it.documentation = new vscode.MarkdownString(p.doc);
        it.insertText = `${p.name} = `;
        items.push(it);
      }
    };
    make(bp.inputs, "input");
    make(bp.outputs, "output");
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
