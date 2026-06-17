// Detects DROID SD cards, writes patches to them, and safely ejects them.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Languages whose documents can be written to a DROID card. `.droider` is
// expanded to plain `.ini` first (see resolveContent).
const UPLOADABLE_LANGS = new Set(["droid", "droider"]);

export class DroidCardManager {
  private statusBarItem: vscode.StatusBarItem;
  private watcher: fs.FSWatcher | undefined;
  private detectedCardPath: string | undefined;

  /**
   * @param resolveContent Produces the exact text to write to the card for a
   * document (expanding megacircuits for `.droider`).
   */
  constructor(
    private resolveContent: (doc: vscode.TextDocument) => Promise<string>
  ) {
    // Create status bar item (on the right side)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "droid.writeAndEject";
    this.statusBarItem.text = "$(debug-disconnect) DROID Card";
    this.statusBarItem.tooltip = "No DROID card detected";
    this.statusBarItem.hide();

    this.startMonitoring();
  }

  private async startMonitoring() {
    // Initial check
    await this.checkForCard();

    // On macOS, watch /Volumes for new mounts
    if (process.platform === "darwin") {
      const volumesPath = "/Volumes";
      try {
        this.watcher = fs.watch(volumesPath, async (eventType, filename) => {
          if (filename) {
            // Small delay to ensure the mount is complete
            setTimeout(() => this.checkForCard(), 500);
          }
        });
      } catch (err) {
        console.error("Failed to watch /Volumes:", err);
      }
    } else if (process.platform === "win32") {
      // On Windows, poll for drive changes every 2 seconds
      setInterval(() => this.checkForCard(), 2000);
    } else {
      // On Linux, watch /media and /mnt
      const mediaPaths = ["/media", "/mnt"];
      for (const mediaPath of mediaPaths) {
        if (fs.existsSync(mediaPath)) {
          try {
            fs.watch(mediaPath, { recursive: true }, async () => {
              setTimeout(() => this.checkForCard(), 500);
            });
          } catch (err) {
            console.error(`Failed to watch ${mediaPath}:`, err);
          }
        }
      }
    }
  }

  private async checkForCard() {
    let found = false;
    let cardPath: string | undefined;

    if (process.platform === "darwin") {
      // macOS: check /Volumes
      const volumesPath = "/Volumes";
      if (fs.existsSync(volumesPath)) {
        const volumes = fs.readdirSync(volumesPath);
        for (const volume of volumes) {
          const fullPath = path.join(volumesPath, volume);
          if (await this.isDroidCard(fullPath)) {
            found = true;
            cardPath = fullPath;
            break;
          }
        }
      }
    } else if (process.platform === "win32") {
      // Windows: check drive letters
      const drives = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      for (const drive of drives) {
        const drivePath = `${drive}:\\`;
        if (fs.existsSync(drivePath) && (await this.isDroidCard(drivePath))) {
          found = true;
          cardPath = drivePath;
          break;
        }
      }
    } else {
      // Linux: check /media and /mnt
      const mediaPaths = ["/media", "/mnt"];
      for (const mediaPath of mediaPaths) {
        if (fs.existsSync(mediaPath)) {
          const entries = fs.readdirSync(mediaPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const fullPath = path.join(mediaPath, entry.name);
              if (await this.isDroidCard(fullPath)) {
                found = true;
                cardPath = fullPath;
                break;
              }
            }
          }
          if (found) break;
        }
      }
    }

    this.detectedCardPath = cardPath;
    this.updateStatusBar(found, cardPath);
  }

  private async isDroidCard(mountPath: string): Promise<boolean> {
    try {
      // Check if it's a directory and readable
      const stat = fs.statSync(mountPath);
      if (!stat.isDirectory()) return false;

      // A DROID card should have a droid.ini file or be named "DROID"
      const droidIniPath = path.join(mountPath, "droid.ini");
      const hasDroidIni = fs.existsSync(droidIniPath);
      const isNamedDroid = path.basename(mountPath).toUpperCase() === "DROID";

      return hasDroidIni || isNamedDroid;
    } catch {
      return false;
    }
  }

  private updateStatusBar(found: boolean, cardPath: string | undefined) {
    const editor = vscode.window.activeTextEditor;
    const lang = editor?.document.languageId ?? "";
    const isUploadable = UPLOADABLE_LANGS.has(lang);
    const isDroider = lang === "droider";

    if (found && isUploadable && cardPath) {
      // Card present + a patch open: write (expanding .droider) and eject.
      this.statusBarItem.command = "droid.writeAndEject";
      this.statusBarItem.text = "$(cloud-upload) Write to DROID";
      this.statusBarItem.tooltip = isDroider
        ? `Build dist/ and write the expanded patch to ${path.basename(cardPath)}, then eject`
        : `Write patch to ${path.basename(cardPath)} and eject`;
      this.statusBarItem.show();
    } else if (!found && isDroider) {
      // No card, but a .droider is open: let the user generate dist/ to validate.
      this.statusBarItem.command = "droid.buildDist";
      this.statusBarItem.text = "$(package) Build to dist";
      this.statusBarItem.tooltip =
        "Expand megacircuits and write dist/<name>.ini (no DROID card needed)";
      this.statusBarItem.show();
    } else if (found && !isUploadable) {
      this.statusBarItem.command = "droid.writeAndEject";
      this.statusBarItem.text = "$(debug-disconnect) DROID Card";
      this.statusBarItem.tooltip = `DROID card detected: ${path.basename(cardPath || "")}`;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.tooltip = "No DROID card detected";
      this.statusBarItem.hide();
    }
  }

  public async writeAndEject() {
    if (!this.detectedCardPath) {
      vscode.window.showErrorMessage("No DROID card detected");
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || !UPLOADABLE_LANGS.has(editor.document.languageId)) {
      vscode.window.showErrorMessage("No DROID patch file is currently open");
      return;
    }

    const droidIniPath = path.join(this.detectedCardPath, "droid.ini");
    const cardName = path.basename(this.detectedCardPath);

    try {
      // Save current document if modified
      if (editor.document.isDirty) {
        await editor.document.save();
      }

      // Resolve the content to write (expanding megacircuits for .droider).
      const content = await this.resolveContent(editor.document);

      // Write to droid.ini
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Writing to ${cardName}...`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 30 });

          // Write file
          fs.writeFileSync(droidIniPath, content, "utf8");
          
          progress.report({ increment: 40, message: "Syncing..." });

          // Ensure all data is written to disk
          if (process.platform === "darwin" || process.platform === "linux") {
            await execAsync("sync");
          }

          progress.report({ increment: 30, message: "Ejecting..." });

          // Eject the card
          await this.ejectCard(this.detectedCardPath!);

          vscode.window.showInformationMessage(
            `✅ Patch written to ${cardName} and card ejected safely`
          );
        }
      );

      // Clear detected card after ejection
      this.detectedCardPath = undefined;
      this.updateStatusBar(false, undefined);
    } catch (err) {
      const error = err as Error;
      vscode.window.showErrorMessage(
        `Failed to write or eject DROID card: ${error.message}`
      );
    }
  }

  private async ejectCard(cardPath: string): Promise<void> {
    if (process.platform === "darwin") {
      // macOS: use diskutil
      await execAsync(`diskutil unmount "${cardPath}"`);
    } else if (process.platform === "win32") {
      // Windows: use a PowerShell command to eject
      // Note: This requires the drive letter
      const driveLetter = cardPath.substring(0, 2);
      await execAsync(
        `powershell -command "(New-Object -ComObject Shell.Application).NameSpace(17).ParseName('${driveLetter}').InvokeVerb('Eject')"`
      );
    } else {
      // Linux: use umount
      await execAsync(`umount "${cardPath}"`);
    }
  }

  public onDidChangeActiveEditor(editor: vscode.TextEditor | undefined) {
    // Update status bar when switching editors
    const found = this.detectedCardPath !== undefined;
    this.updateStatusBar(found, this.detectedCardPath);
  }

  public dispose() {
    this.statusBarItem.dispose();
    if (this.watcher) {
      this.watcher.close();
    }
  }
}
