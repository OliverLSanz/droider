// Extension entry point. Its only responsibility is to connect the pure logic
// (data.ts + linter.ts) with the VSCode API:
//   - load the YAML data on activation,
//   - re-analyze the document when it is opened or changed,
//   - turn each Problem into a vscode.Diagnostic (the red underline).

import * as vscode from "vscode";
import * as path from "path";
import { DroidData } from "./data";
import { lint, modeForLanguageId } from "./linter";
import { expandToIni } from "./blueprints";
import { BlueprintRegistry } from "./blueprintRegistry";
import { DroidSemanticTokensProvider, SEMANTIC_LEGEND } from "./semantic";
import { CableDecorator } from "./cables";
import { DroidCompletionProvider } from "./completion";
import { DroidHoverProvider } from "./hover";
import { DroidCardManager } from "./droidCard";
import { HardwareViewProvider } from "./hardwareView";
import { CircuitGraphProvider } from "./circuitGraph";

// Every language this extension serves; `droid` is plain .ini, `droider` allows
// the syntactic sugar, `droid-blueprint` defines megacircuits.
const DROID_LANGS = ["droid", "droider", "droid-blueprint"];
const DROID_SELECTOR: vscode.DocumentSelector = DROID_LANGS.map((language) => ({
  language,
}));

let data: DroidData | undefined;
let registry: BlueprintRegistry | undefined;
let collection: vscode.DiagnosticCollection;
let cardManager: DroidCardManager | undefined;
let hardwareView: HardwareViewProvider | undefined;
let circuitGraph: CircuitGraphProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
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

  // Megacircuit (blueprint) registry: scans **/*.blueprint and watches changes.
  registry = new BlueprintRegistry();
  await registry.initialize(context);

  // Semantic highlighting: colors inputs vs outputs of each circuit.
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      DROID_SELECTOR,
      new DroidSemanticTokensProvider(data, registry),
      SEMANTIC_LEGEND
    )
  );

  // Autocompletion (circuits, parameters, registers, cables) and hover.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      DROID_SELECTOR,
      new DroidCompletionProvider(data, registry),
      "[",
      "=",
      "_"
    ),
    vscode.languages.registerHoverProvider(
      DROID_SELECTOR,
      new DroidHoverProvider(data, registry)
    ),
    // Auto-indent after [circuit] headers and trigger suggestions after Enter.
    vscode.languages.registerOnTypeFormattingEditProvider(
      DROID_SELECTOR,
      new DroidEnterProvider(),
      "\n"
    )
  );

  // "Rainbow" decoration of internal cables: one color per cable.
  const decorator = new CableDecorator(data, registry);
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

  // When a blueprint changes, megacircuit usages elsewhere may become (in)valid:
  // re-lint and recolor every open DROID document.
  context.subscriptions.push(
    registry.onDidChange(() => {
      for (const doc of vscode.workspace.textDocuments) refresh(doc);
      decorateAll();
    })
  );

  // DROID card detection and write/eject functionality. For .droider files the
  // content uploaded to the card is the expanded .ini (also saved to dist/).
  cardManager = new DroidCardManager((doc) => resolveUploadContent(doc));
  context.subscriptions.push(cardManager);
  context.subscriptions.push(
    vscode.commands.registerCommand("droid.writeAndEject", () => {
      cardManager?.writeAndEject();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("droid.buildDist", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "droider") {
        vscode.window.showErrorMessage("Open a .droider file to build it.");
        return;
      }
      try {
        const { distUri, problems } = await buildDroiderToDist(editor.document);
        const errs = problems.filter((p) => p.severity === "error").length;
        const rel = vscode.workspace.asRelativePath(distUri);
        if (errs > 0) {
          vscode.window.showWarningMessage(
            `Built ${rel} with ${errs} expansion error(s) — check the patch.`
          );
        } else {
          vscode.window.showInformationMessage(`Built ${rel}`);
        }
      } catch (e) {
        vscode.window.showErrorMessage("Build failed: " + (e as Error).message);
      }
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      cardManager?.onDidChangeActiveEditor(editor);
    })
  );

  // Hardware view: visual representation of controllers. The serializer revives
  // an open hardware pane after a window reload (otherwise it comes back blank).
  hardwareView = new HardwareViewProvider(context, data);
  context.subscriptions.push(
    vscode.commands.registerCommand("droid.showHardwareView", () => {
      hardwareView?.show();
    }),
    vscode.window.registerWebviewPanelSerializer(HardwareViewProvider.viewType, {
      async deserializeWebviewPanel(panel, state) {
        await hardwareView?.restore(panel, state);
      },
    })
  );

  // Circuit graph: force-directed view of the interconnected circuits. The
  // serializer revives an open graph pane after a window reload.
  circuitGraph = new CircuitGraphProvider(context, data, registry);
  context.subscriptions.push(
    vscode.commands.registerCommand("droid.showCircuitGraph", () => {
      circuitGraph?.show();
    }),
    vscode.window.registerWebviewPanelSerializer(CircuitGraphProvider.viewType, {
      async deserializeWebviewPanel(panel, state) {
        await circuitGraph?.restore(panel, state);
      },
    })
  );
}

function refresh(doc: vscode.TextDocument) {
  if (!data || !DROID_LANGS.includes(doc.languageId)) return;

  const mode = modeForLanguageId(doc.languageId);
  const diagnostics = lint(doc.getText(), data, {
    mode,
    blueprints: registry?.all(),
  }).map((p) => {
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

/**
 * Expands a .droider document and writes the result to `<workspace>/dist/<name>.ini`.
 * Returns the dist URI, the expanded text and any expansion problems.
 */
async function buildDroiderToDist(
  doc: vscode.TextDocument
): Promise<{ distUri: vscode.Uri; iniText: string; problems: ReturnType<typeof expandToIni>["problems"] }> {
  const { ini, problems } = expandToIni(doc.getText(), registry?.all() ?? new Map());
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const baseDir = folder ? folder.uri : vscode.Uri.file(path.dirname(doc.uri.fsPath));
  const name = path.basename(doc.uri.fsPath).replace(/\.droider$/, "");
  const distDir = vscode.Uri.joinPath(baseDir, "dist");
  await vscode.workspace.fs.createDirectory(distDir);
  const distUri = vscode.Uri.joinPath(distDir, `${name}.ini`);
  await vscode.workspace.fs.writeFile(distUri, Buffer.from(ini, "utf8"));
  return { distUri, iniText: ini, problems };
}

/**
 * Content to write to the DROID card for the given document: plain text for
 * .ini, or the expanded (and dist-saved) .ini for .droider.
 */
async function resolveUploadContent(
  doc: vscode.TextDocument
): Promise<string> {
  if (doc.languageId === "droider") {
    const { iniText } = await buildDroiderToDist(doc);
    return iniText;
  }
  return doc.getText();
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
