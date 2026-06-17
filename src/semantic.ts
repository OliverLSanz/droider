// Semantic highlighting. This is the ONLY layer that colors the content of
// parameter lines (names, registers, numbers, cables, etc.). The TextMate
// grammar only handles comments and headers.
//
// Why everything here and not in the grammar? Because the grammar is
// context-blind: it doesn't know whether a circuit is known, nor whether a name
// is an input or an output. If the grammar colored these things, its "generic"
// color would flash for an instant before the correct semantic color arrived.
// By coloring only from here, there is no previous color to correct.

import * as vscode from "vscode";
import { DroidData, ParamRole } from "./data";
import { BlueprintRegistry } from "./blueprintRegistry";
import { modeForLanguageId } from "./linter";

// Token types. The ones starting with "droid" are custom (declared and colored
// in package.json); number/string/operator are standard and colored by the
// theme automatically.
export const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(
  [
    "droidInput",
    "droidOutput",
    "droidUnverified",
    "droidRegister",
    "droidBoolean",
    "number",
    "string",
    "operator",
  ],
  []
);

const HEADER_RE = /^\[([a-z0-9]+)\]$/;

// Tokenizes the right-hand side of a parameter: texts, cables, numbers, on/off,
// registers and operators.
const VALUE_RE =
  /"[^"]*"|_[A-Za-z0-9_]+|-?\d+(?:\.\d+)?(?:[V%])?|\b(?:on|off)\b|[A-Za-z][A-Za-z0-9]*(?:\.\d+)?|[*+/-]/g;

// Returns null for cables: their color is handled by CableDecorator (a distinct
// color per cable), not by the semantic layer.
function valueTokenType(tok: string): string | null {
  if (tok.startsWith('"')) return "string";
  if (tok.startsWith("_")) return null;
  if (/^-?\d/.test(tok)) return "number";
  if (tok === "on" || tok === "off") return "droidBoolean";
  if (/^[*+/-]$/.test(tok)) return "operator";
  return "droidRegister";
}

export class DroidSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider
{
  constructor(private data: DroidData, private registry: BlueprintRegistry) {}

  provideDocumentSemanticTokens(
    doc: vscode.TextDocument
  ): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND);
    const typeIndex = (name: string) =>
      SEMANTIC_LEGEND.tokenTypes.indexOf(name);

    const mode = modeForLanguageId(doc.languageId);
    const sugar = mode !== "ini";

    let curCircuit: string | null = null;
    let curPorts: Map<string, ParamRole> | null = null; // blueprint instance
    let sectionRole: ParamRole | null = null; // inside [input]/[output]
    let inUnknownCircuit = false;
    let declaring = true;

    const lines = doc.getText().split(/\r?\n/);
    lines.forEach((raw, i) => {
      const code = raw.split("#")[0];
      const trimmed = code.trim();
      if (!trimmed) return;

      // --- Header ---
      const hm = trimmed.match(HEADER_RE);
      if (hm) {
        const name = hm[1];
        if (this.data.controllers.has(name) && declaring) return;
        declaring = false;
        curCircuit = null;
        curPorts = null;
        sectionRole = null;
        inUnknownCircuit = false;

        if (mode === "blueprint" && (name === "input" || name === "output")) {
          sectionRole = name === "input" ? "input" : "output";
        } else if (sugar && this.registry.all().has(name)) {
          const bp = this.registry.all().get(name)!;
          curPorts = new Map<string, ParamRole>();
          for (const p of bp.inputs) curPorts.set(p.name, "input");
          for (const p of bp.outputs) curPorts.set(p.name, "output");
        } else if (this.data.circuits.has(name)) {
          curCircuit = name;
        } else {
          inUnknownCircuit = true;
        }
        return;
      }
      declaring = false;

      // --- Inside an unknown circuit: dim the whole line ---
      if (inUnknownCircuit) {
        const start = code.search(/\S/);
        const end = code.replace(/\s+$/, "").length;
        if (start >= 0 && end > start) {
          builder.push(i, start, end - start, typeIndex("droidUnverified"), 0);
        }
        return;
      }

      const eq = code.indexOf("=");

      // --- Port declaration inside [input]/[output]: name [= default] ---
      if (sectionRole) {
        const m = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)/);
        if (m) {
          const pStart = code.indexOf(m[1]);
          builder.push(
            i,
            pStart,
            m[1].length,
            typeIndex(sectionRole === "input" ? "droidInput" : "droidOutput"),
            0
          );
          if (eq >= 0) builder.push(i, eq, 1, typeIndex("operator"), 0);
          // Color the default value tokens (numbers/registers) after '='.
          if (eq >= 0) this.colorValue(builder, typeIndex, i, eq + 1, code.slice(eq + 1));
        }
        return;
      }

      // --- Parameter line ---
      if (eq < 0) return;
      if (!curCircuit && !curPorts) return;

      // Parameter / port name (input/output). If unrecognized, it is left
      // without color (and the linter underlines it).
      const pname = code.slice(0, eq).trim();
      let role: ParamRole | null = null;
      if (curCircuit) role = this.data.paramRole(curCircuit, pname) ?? null;
      else if (curPorts) role = curPorts.get(pname) ?? null;
      if (role) {
        const pStart = code.indexOf(pname);
        builder.push(
          i,
          pStart,
          pname.length,
          typeIndex(role === "input" ? "droidInput" : "droidOutput"),
          0
        );
      }

      // The '=' sign.
      builder.push(i, eq, 1, typeIndex("operator"), 0);

      // Value tokens.
      this.colorValue(builder, typeIndex, i, eq + 1, code.slice(eq + 1));
    });

    return builder.build();
  }

  /** Colors the value tokens (numbers, strings, registers, operators). */
  private colorValue(
    builder: vscode.SemanticTokensBuilder,
    typeIndex: (name: string) => number,
    line: number,
    valueStart: number,
    value: string
  ): void {
    let m: RegExpExecArray | null;
    VALUE_RE.lastIndex = 0;
    while ((m = VALUE_RE.exec(value)) !== null) {
      const tok = m[0];
      const type = valueTokenType(tok);
      if (type) {
        builder.push(line, valueStart + m.index, tok.length, typeIndex(type), 0);
      }
    }
  }
}
