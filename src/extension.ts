// Extension entry point. Its only responsibility is to connect the pure logic
// (data.ts + linter.ts) with the VSCode API:
//   - load the YAML data on activation,
//   - re-analyze the document when it is opened or changed,
//   - turn each Problem into a vscode.Diagnostic (the red underline).

import * as vscode from "vscode";
import { DroidData } from "./data";
import { lint } from "./linter";
import { DroidSemanticTokensProvider, SEMANTIC_LEGEND } from "./semantic";
import { CableDecorator } from "./cables";
import { DroidCompletionProvider } from "./completion";
import { DroidHoverProvider } from "./hover";
import { DroidCardManager } from "./droidCard";
import { HardwareViewProvider } from "./hardwareView";
import { CircuitGraphProvider } from "./circuitGraph";

let data: DroidData | undefined;
let collection: vscode.DiagnosticCollection;
let cardManager: DroidCardManager | undefined;
let hardwareView: HardwareViewProvider | undefined;
let circuitGraph: CircuitGraphProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  collection = vscode.languages.createDiagnosticCollection("droid");
  context.subscriptions.push(collection);

  // Look for the YAML files in the extension folder and in the open workspaces.
  const searchDirs = [context.extensionPath];
  for (const wf of vscode.workspace.workspaceFolders ?? []) {
    searchDirs.push(wf.uri.fsPath);
  }
  try {
    data = DroidData.load(searchDirs);
  } catch (e) {
    vscode.window.showErrorMessage(
      "DROID: could not load the language data: " + (e as Error).message
    );
    return;
  }

  // Semantic highlighting: colors inputs vs outputs of each circuit.
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "droid" },
      new DroidSemanticTokensProvider(data),
      SEMANTIC_LEGEND
    )
  );

  // Autocompletion (circuits, parameters, registers, cables) and hover.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "droid" },
      new DroidCompletionProvider(data),
      "[",
      "=",
      "_"
    ),
    vscode.languages.registerHoverProvider(
      { language: "droid" },
      new DroidHoverProvider(data)
    ),
    // Auto-indent after [circuit] headers and trigger suggestions after Enter.
    vscode.languages.registerOnTypeFormattingEditProvider(
      { language: "droid" },
      new DroidEnterProvider(),
      "\n"
    )
  );

  // "Rainbow" decoration of internal cables: one color per cable.
  const decorator = new CableDecorator(data);
  context.subscriptions.push(decorator);
  const decorateAll = () =>
    vscode.window.visibleTextEditors.forEach((ed) => decorator.decorate(ed));
  decorateAll();
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(decorateAll)
  );

  // Analyze the already-open documents and react to changes.
  for (const doc of vscode.workspace.textDocuments) refresh(doc);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => {
      refresh(e.document);
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document === e.document) decorator.decorate(ed);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri))
  );

  // DROID card detection and write/eject functionality
  cardManager = new DroidCardManager();
  context.subscriptions.push(cardManager);
  context.subscriptions.push(
    vscode.commands.registerCommand("droid.writeAndEject", () => {
      cardManager?.writeAndEject();
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      cardManager?.onDidChangeActiveEditor(editor);
    })
  );

  // Hardware view: visual representation of controllers
  hardwareView = new HardwareViewProvider(context, data);
  context.subscriptions.push(
    vscode.commands.registerCommand("droid.showHardwareView", () => {
      hardwareView?.show();
    })
  );

  // Circuit graph: force-directed view of the interconnected circuits.
  circuitGraph = new CircuitGraphProvider(context, data);
  context.subscriptions.push(
    vscode.commands.registerCommand("droid.showCircuitGraph", () => {
      circuitGraph?.show();
    })
  );
}

function refresh(doc: vscode.TextDocument) {
  if (!data || doc.languageId !== "droid") return;

  const diagnostics = lint(doc.getText(), data).map((p) => {
    const range = new vscode.Range(p.line, p.startCol, p.line, p.endCol);
    const severity =
      p.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;
    const d = new vscode.Diagnostic(range, p.message, severity);
    d.source = "droid";
    return d;
  });
  collection.set(doc.uri, diagnostics);
}

class DroidEnterProvider implements vscode.OnTypeFormattingEditProvider {
  provideOnTypeFormattingEdits(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.TextEdit[] {
    if (pos.line === 0) return [];
    const prevText = doc.lineAt(pos.line - 1).text;
    const prevTrimmed = prevText.trim();

    const isHeader = /^\[[a-z0-9]+\]$/.test(prevTrimmed);
    // Incomplete header: [circuit without closing ]
    const isIncompleteHeader = /^\[[a-z][a-z0-9]*$/.test(prevTrimmed);
    // Parameter line: starts with whitespace followed by a param assignment
    const isParam = /^\s+[a-z][a-z0-9_]*\d*\s*=/.test(prevText);

    if (!isHeader && !isIncompleteHeader && !isParam) return [];

    setTimeout(
      () => vscode.commands.executeCommand("editor.action.triggerSuggest"),
      100
    );

    const edits: vscode.TextEdit[] = [];

    // If the header is incomplete, close it by adding ]
    if (isIncompleteHeader) {
      const prevLine = pos.line - 1;
      const endOfPrevLine = doc.lineAt(prevLine).range.end;
      edits.push(vscode.TextEdit.insert(endOfPrevLine, "]"));
    }

    // After a circuit header (complete or incomplete): insert 4-space indent
    if (isHeader || isIncompleteHeader) {
      edits.push(vscode.TextEdit.insert(pos, "    "));
    }

    return edits;
  }
}

export function deactivate() {}
