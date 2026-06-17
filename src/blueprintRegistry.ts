// Keeps an up-to-date map of the megacircuits (blueprints) defined anywhere in
// the workspace. Scans every `**/*.blueprint` file on activation and watches for
// changes so autocompletion, linting and expansion always see the latest
// definitions. The megacircuit name is the file base name (mix2.blueprint -> mix2).

import * as vscode from "vscode";
import * as path from "path";
import { Blueprint, parseBlueprint } from "./blueprints";

export class BlueprintRegistry {
  private map = new Map<string, Blueprint>();
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires whenever the set of blueprints changes (so docs can be re-linted). */
  readonly onDidChange = this.emitter.event;

  /** Current blueprints, keyed by megacircuit name. */
  all(): Map<string, Blueprint> {
    return this.map;
  }

  async initialize(context: vscode.ExtensionContext): Promise<void> {
    await this.scanAll();

    this.watcher = vscode.workspace.createFileSystemWatcher("**/*.blueprint");
    const reload = async (uri: vscode.Uri) => {
      await this.loadFile(uri);
      this.emitter.fire();
    };
    const remove = (uri: vscode.Uri) => {
      this.map.delete(nameFor(uri));
      this.emitter.fire();
    };
    this.watcher.onDidCreate(reload);
    this.watcher.onDidChange(reload);
    this.watcher.onDidDelete(remove);

    context.subscriptions.push(this.watcher, this.emitter);
  }

  private async scanAll(): Promise<void> {
    this.map.clear();
    const uris = await vscode.workspace.findFiles("**/*.blueprint");
    for (const uri of uris) await this.loadFile(uri);
  }

  private async loadFile(uri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString("utf8");
      this.map.set(nameFor(uri), parseBlueprint(text, nameFor(uri)));
    } catch {
      // Unreadable file: ignore (it may be mid-write or deleted).
    }
  }
}

/** Megacircuit name from a `.blueprint` file URI. */
function nameFor(uri: vscode.Uri): string {
  return path.basename(uri.fsPath, ".blueprint");
}
