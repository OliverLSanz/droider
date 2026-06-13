// Hardware visualization webview panel: shows a visual representation of the
// DROID controllers declared in the patch, with labels from the legend.

import * as vscode from "vscode";
import { DroidData } from "./data";
import { labelSectionAtLine } from "./labels";

export interface LabelInfo {
  register: string;
  short?: string;
  long?: string;
}

export interface ControllerInPatch {
  type: string;
  number: number; // 1-based controller number in chain
  labels: LabelInfo[];
}

/**
 * Parse the patch text to extract:
 * 1. The controller chain (sequence of [controller-type] declarations)
 * 2. The label legend (# INPUTS, # OUTPUTS, # CONTROLLER N sections)
 * 3. The master type (master=16 or master=18)
 */
export class PatchParser {
  constructor(private data: DroidData) {}

  parse(text: string): { controllers: ControllerInPatch[]; master: string; masterLabels: LabelInfo[] } {
    const lines = text.split(/\r?\n/);
    const chain = this.data.controllerChain(lines);
    const labels = this.parseLabels(lines);
    const master = this.parseMaster(lines);

    return {
      controllers: chain.map((type, idx) => ({
        type,
        number: idx + 1,
        labels: labels.filter((lab) => this.belongsToController(lab.register, idx + 1)),
      })),
      master,
      masterLabels: labels.filter((lab) => /^[IO]\d+$/.test(lab.register)),
    };
  }

  private parseMaster(lines: string[]): string {
    for (const line of lines) {
      const match = line.match(/^\s*#\s*LABELS:\s*master\s*=\s*(\d+)/i);
      if (match) {
        return match[1] === "18" ? "master18" : "master";
      }
    }
    return "master"; // Default to master 16
  }

  private parseLabels(lines: string[]): LabelInfo[] {
    const labels: LabelInfo[] = [];
    const ENTRY =
      /^#\s+([A-Za-z][A-Za-z0-9]*(?:\.\d+)?):\s*(?:\[([^\]]*)\])?\s*(.*?)\s*$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(ENTRY);
      if (m) {
        labels.push({
          register: m[1],
          short: m[2] || undefined,
          long: m[3] || undefined,
        });
      }
    }

    return labels;
  }

  private belongsToController(register: string, controllerNum: number): boolean {
    const m = register.match(/^[A-Za-z]+(\d+)\./);
    return m ? Number(m[1]) === controllerNum : false;
  }
}

/**
 * Manages the hardware view webview panel.
 */
export class HardwareViewProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private data: DroidData
  ) {}

  show() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "droid") {
      vscode.window.showInformationMessage("Open a DROID patch file first");
      return;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "droidHardwareView",
        "DROID Hardware",
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });

      // Handle messages from the webview
      this.panel.webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === 'copy') {
            await vscode.env.clipboard.writeText(message.text);
          }
        }
      );
    }

    this.updateContent(editor.document);

    // Update when the document changes
    const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === editor.document && this.panel) {
        this.updateContent(e.document);
      }
    });

    this.panel.onDidDispose(() => disposable.dispose());
  }

  private updateContent(document: vscode.TextDocument) {
    if (!this.panel) return;

    const parser = new PatchParser(this.data);
    const { controllers, master, masterLabels } = parser.parse(document.getText());

    this.panel.webview.html = this.generateHTML(controllers, master, masterLabels);
  }

  private generateHTML(controllers: ControllerInPatch[], masterType: string, masterLabels: LabelInfo[]): string {
    const masterHTML = masterType === "master" ? this.generateMaster16HTML(masterLabels) : "";
    
    const controllersHTML = controllers
      .map((ctrl) => {
        if (ctrl.type === "p2b8") return this.generateP2B8HTML(ctrl);
        if (ctrl.type === "p10") return this.generateP10HTML(ctrl);
        if (ctrl.type === "s10") return this.generateS10HTML(ctrl);
        return "";
      })
      .filter((html) => html !== "")
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DROID Hardware View</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            color: #d4b896;
            background-color: #1a1a1a;
            padding: 0;
            margin: 0;
            overflow-x: auto;
        }
        
        .controllers-container {
            display: flex;
            gap: 0;
            flex-wrap: nowrap;
            justify-content: flex-start;
            overflow-x: auto;
            padding: 20px;
        }
        
        .controller {
            background: linear-gradient(to bottom, #2d2d2d, #252525);
            border: 1px solid #1a1a1a;
            border-radius: 3px;
            padding: 12px 8px;
            width: 80px;
            min-height: 460px;
            box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        
        .controller-header {
            text-align: center;
            margin-bottom: 2px;
        }
        
        .controller-title {
            font-weight: bold;
            color: #d4b896;
            font-size: 16px;
            letter-spacing: 1px;
            margin-bottom: 0;
        }
        
        .controller-subtitle {
            font-size: 9px;
            color: #a89876;
            letter-spacing: 0.5px;
            margin-top: 2px;
        }
        
        .pots-section {
            display: flex;
            flex-direction: column;
            gap: 20px;
            margin: 15px 0 25px 0;
            align-items: center;
        }
        
        .pot-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
        }
        
        .element {
            position: relative;
        }
        
        .pot {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: radial-gradient(circle at 40% 40%, #4a4a4a, #1a1a1a);
            border: 3px solid #3a3a3a;
            position: relative;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.7);
        }
        
        /* Marcas radiales alrededor del pot */
        .pot::before {
            content: '';
            position: absolute;
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: repeating-conic-gradient(
                from 0deg,
                transparent 0deg,
                transparent 8deg,
                #d4b896 8deg,
                #d4b896 10deg
            );
            mask: radial-gradient(circle, transparent 28px, black 28px, black 32px, transparent 32px);
            -webkit-mask: radial-gradient(circle, transparent 28px, black 28px, black 32px, transparent 32px);
        }
        
        /* Indicador del pot (la palanca) */
        .pot::after {
            content: '';
            position: absolute;
            width: 38px;
            height: 38px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, #f5f5f5, #c0c0c0);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.5);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }
        
        /* Línea indicadora en el centro del pot */
        .pot-indicator {
            position: absolute;
            width: 3px;
            height: 8px;
            background: #666;
            top: 8px;
            border-radius: 1px;
            z-index: 2;
        }
        
        .pot-labels {
            display: flex;
            justify-content: space-between;
            width: 60px;
            font-size: 10px;
            color: #d4b896;
            margin-top: 5px;
        }
        
        .pot-label {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 10px;
            font-weight: bold;
            color: #1a1a1a;
            z-index: 3;
            text-align: center;
            max-width: 40px;
            white-space: nowrap;
            text-shadow: 0 0 2px rgba(255, 255, 255, 0.5);
        }
        
        .buttons-section {
            display: grid;
            grid-template-columns: 28px 28px;
            grid-template-rows: repeat(4, auto);
            gap: 12px 4px;
            justify-items: center;
            align-items: center;
            row-gap: 18px;
        }
        
        .button-row {
            display: contents;
        }
        
        .button-number {
            font-size: 11px;
            color: #d4b896;
            position: absolute;
            top: -16px;
            font-weight: normal;
        }
        
        .button {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, #e0e0e0, #b0b0b0);
            border: 2px solid #7a7a7a;
            cursor: pointer;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3);
        }
        
        .button:hover, .pot:hover {
            transform: scale(1.05);
            transition: all 0.2s;
        }
        
        .mini-pot:hover {
            transform: scale(1.05);
            transition: all 0.2s;
        }
        
        /* S10 Rotary Switches */
        .rotary-switch {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: radial-gradient(circle at 40% 40%, #4a4a4a, #1a1a1a);
            border: 3px solid #3a3a3a;
            position: relative;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.7);
        }
        
        /* Marcas radiales para switch rotativo (más que el pot) */
        .rotary-switch::before {
            content: '';
            position: absolute;
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: repeating-conic-gradient(
                from 0deg,
                transparent 0deg,
                transparent 5deg,
                #d4b896 5deg,
                #d4b896 6deg
            );
            mask: radial-gradient(circle, transparent 28px, black 28px, black 32px, transparent 32px);
            -webkit-mask: radial-gradient(circle, transparent 28px, black 28px, black 32px, transparent 32px);
        }
        
        .rotary-switch::after {
            content: '';
            position: absolute;
            width: 38px;
            height: 38px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, #f5f5f5, #c0c0c0);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.5);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }
        
        .rotary-switch-indicator {
            position: absolute;
            width: 3px;
            height: 8px;
            background: #666;
            top: 8px;
            border-radius: 1px;
            z-index: 2;
        }
        
        .rotary-switch-label {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 10px;
            font-weight: bold;
            color: #1a1a1a;
            z-index: 3;
            text-align: center;
            max-width: 40px;
            white-space: nowrap;
            text-shadow: 0 0 2px rgba(255, 255, 255, 0.5);
        }
        
        .rotary-switch:hover {
            transform: scale(1.05);
            transition: all 0.2s;
        }
        
        /* S10 Small Toggle Switches */
        .mini-switches-section {
            display: grid;
            grid-template-columns: 28px 28px;
            grid-template-rows: repeat(4, auto);
            gap: 8px 8px;
            justify-items: center;
            align-items: center;
            row-gap: 18px;
            margin-top: 20px;
        }
        
        .mini-switch-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
        }
        
        .mini-switch {
            width: 16px;
            height: 28px;
            background: linear-gradient(to bottom, #3a3a3a, #2a2a2a);
            border: 2px solid #5a5a5a;
            border-radius: 3px;
            position: relative;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
        }
        
        /* Toggle de 3 posiciones */
        .mini-switch::after {
            content: '';
            position: absolute;
            width: 10px;
            height: 8px;
            background: radial-gradient(circle at 30% 30%, #e0e0e0, #a0a0a0);
            border-radius: 2px;
            top: 50%;
            transform: translateY(-50%);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        }
        
        .mini-switch-label {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 7px;
            font-weight: bold;
            color: #1a1a1a;
            z-index: 10;
            text-align: center;
            white-space: nowrap;
            pointer-events: none;
            background: rgba(212, 184, 150, 0.95);
            padding: 2px 4px;
            border-radius: 2px;
            border: 1px solid rgba(180, 154, 120, 0.8);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            line-height: 1;
        }
        
        .mini-switch-number {
            font-size: 9px;
            color: #d4b896;
            position: absolute;
            top: -14px;
            font-weight: normal;
        }
        
        .mini-switch:hover {
            transform: scale(1.05);
            transition: all 0.2s;
        }
        
        /* Master 16 */
        .master-container {
            display: inline-block;
        }
        
        .master {
            background: linear-gradient(to bottom, #2d2d2d, #252525);
            border: 1px solid #1a1a1a;
            border-radius: 3px;
            padding: 15px;
            width: 160px;
            min-height: 460px;
            box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        
        .master-header {
            text-align: center;
            margin-bottom: 10px;
        }
        
        .master-title {
            font-weight: bold;
            color: #d4b896;
            font-size: 12px;
            letter-spacing: 1.5px;
            margin-bottom: 2px;
        }
        
        .master-subtitle {
            font-size: 8px;
            color: #a89876;
            letter-spacing: 1px;
        }
        
        .master-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            margin-bottom: 15px;
            gap: 10px;
        }
        
        .master-pot {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: radial-gradient(circle at 40% 40%, #4a4a4a, #1a1a1a);
            border: 3px solid #d4b896;
            position: relative;
            box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7);
        }
        
        .master-pot::after {
            content: '';
            position: absolute;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, #f5f5f5, #c0c0c0);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.5);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }
        
        .master-display {
            flex: 1;
            height: 40px;
            background: linear-gradient(to bottom, #1a1a1a, #0a0a0a);
            border: 2px solid #d4b896;
            border-radius: 3px;
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            grid-template-rows: repeat(2, 1fr);
            gap: 1px;
            padding: 2px;
        }
        
        .master-display-segment {
            background: rgba(212, 184, 150, 0.15);
            border-radius: 1px;
        }
        
        .master-led-matrix {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            grid-template-rows: repeat(4, 1fr);
            gap: 4px;
            margin-bottom: 15px;
            width: 100%;
        }
        
        .master-led {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, #3a3a3a, #2a2a2a);
            border: 2px solid #d4b896;
            border-radius: 4px;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
        }
        
        .master-io-section {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            grid-template-rows: repeat(4, 1fr);
            gap: 6px;
            width: 100%;
        }
        
        .master-io-jack {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, #f5f5f5, #c0c0c0);
            border: 2px solid #5a5a5a;
            position: relative;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.3);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .master-io-jack::after {
            content: '';
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #1a1a1a;
            box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.8);
        }
        
        .master-io-jack:hover {
            transform: scale(1.05);
            transition: all 0.2s;
        }
        
        .master-io-label {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 7px;
            font-weight: bold;
            color: #1a1a1a;
            z-index: 10;
            text-align: center;
            white-space: nowrap;
            pointer-events: none;
            background: rgba(212, 184, 150, 0.95);
            padding: 2px 4px;
            border-radius: 2px;
            border: 1px solid rgba(180, 154, 120, 0.8);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            line-height: 1;
        }
        
        .button-label {
            font-size: 8px;
            font-weight: bold;
            color: #1a1a1a;
            text-align: center;
            max-width: 24px;
            white-space: nowrap;
            z-index: 1;
            text-shadow: 0 0 1px rgba(255, 255, 255, 0.3);
        }
        
        /* P10 Mini Pots */
        .mini-pots-section {
            display: grid;
            grid-template-columns: 26px 26px;
            grid-template-rows: repeat(4, auto);
            gap: 8px 8px;
            justify-items: center;
            align-items: center;
            row-gap: 18px;
            margin-top: 20px;
        }
        
        .mini-pot-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
        }
        
        .mini-pot {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: radial-gradient(circle at 40% 40%, #4a4a4a, #1a1a1a);
            border: 2px solid #3a3a3a;
            position: relative;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.7);
        }
        
        /* Marcas radiales alrededor del mini pot */
        .mini-pot::before {
            content: '';
            position: absolute;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: repeating-conic-gradient(
                from 0deg,
                transparent 0deg,
                transparent 14deg,
                #d4b896 14deg,
                #d4b896 16deg
            );
            mask: radial-gradient(circle, transparent 14px, black 14px, black 17px, transparent 17px);
            -webkit-mask: radial-gradient(circle, transparent 14px, black 14px, black 17px, transparent 17px);
        }
        
        .mini-pot::after {
            content: '';
            position: absolute;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, #f5f5f5, #c0c0c0);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.5);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }
        
        .mini-pot-indicator {
            position: absolute;
            width: 2px;
            height: 5px;
            background: #666;
            top: 4px;
            border-radius: 1px;
            z-index: 2;
        }
        
        .mini-pot-label {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 7px;
            font-weight: bold;
            color: #1a1a1a;
            z-index: 3;
            text-align: center;
            max-width: 16px;
            white-space: nowrap;
            text-shadow: 0 0 1px rgba(255, 255, 255, 0.5);
        }
        
        .mini-pot-number {
            font-size: 9px;
            color: #d4b896;
            position: absolute;
            top: -14px;
            font-weight: normal;
        }
        
        .element {
            position: relative;
        }
        
        .tooltip {
            visibility: hidden;
            background-color: #3a3a3a;
            color: #d4b896;
            border: 1px solid #d4b896;
            text-align: left;
            border-radius: 4px;
            padding: 8px 10px;
            position: absolute;
            z-index: 1000;
            max-width: 400px;
            min-width: 100px;
            font-size: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
            word-wrap: break-word;
            white-space: normal;
            line-height: 1.4;
        }
        
        .element:hover .tooltip {
            visibility: visible;
        }
        
        .pot-container:hover .tooltip {
            visibility: visible;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #8a8a8a;
        }
        
        h1 {
            display: none;
        }
        
        .copy-notification {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #d4b896;
            color: #1a1a1a;
            padding: 12px 24px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            z-index: 2000;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .copy-notification.show {
            opacity: 1;
        }
    </style>
</head>
<body>
    <div class="controllers-container">
        ${masterHTML}
        ${controllersHTML}
    </div>
    ${
      controllers.length === 0 && !masterHTML
        ? `<div class="empty-state">No controllers found in this patch</div>`
        : ""
    }
    <div id="copyNotification" class="copy-notification">Label copied</div>
    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const notification = document.getElementById('copyNotification');
            let hideTimeout;
            
            document.addEventListener('click', function(e) {
                const element = e.target.closest('.element');
                if (element && element.dataset.register) {
                    const register = element.dataset.register;
                    
                    // Copy to clipboard using VSCode API
                    vscode.postMessage({
                        command: 'copy',
                        text: register
                    });
                    
                    // Show notification
                    clearTimeout(hideTimeout);
                    notification.classList.add('show');
                    
                    // Hide after 2 seconds
                    hideTimeout = setTimeout(function() {
                        notification.classList.remove('show');
                    }, 2000);
                }
            });
        })();
    </script>
</body>
</html>`;
  }

  private generateP2B8HTML(controller: ControllerInPatch): string {
    // Get labels for pots (P) and buttons (B)
    const potLabels = [1, 2].map((idx) =>
      controller.labels.find((l) => l.register === `P${controller.number}.${idx}`)
    );
    const buttonLabels = [1, 2, 3, 4, 5, 6, 7, 8].map((idx) =>
      controller.labels.find((l) => l.register === `B${controller.number}.${idx}`)
    );

    const potsHTML = potLabels
      .map(
        (label, idx) => {
          const register = `P${controller.number}.${idx + 1}`;
          const shortLabel = label?.short ? label.short.substring(0, 5) : "";
          const tooltipText = label?.long ? `${register} – ${label.long}` : register;
          return `
        <div class="pot-container element" data-register="${register}">
            <div class="pot">
                <div class="pot-indicator"></div>
                ${shortLabel ? `<div class="pot-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            </div>
            <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
        }
      )
      .join("");

    const buttonsHTML = buttonLabels
      .map(
        (label, idx) => {
          const num = idx + 1;
          const register = `B${controller.number}.${num}`;
          const shortLabel = label?.short ? label.short.substring(0, 5) : "";
          const tooltipText = label?.long ? `${register} – ${label.long}` : register;
          return `
        <div class="element button" data-register="${register}">
            <span class="button-number">${num}</span>
            ${shortLabel ? `<div class="button-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
        }
      )
      .join("");

    return `
        <div class="controller">
            <div class="controller-header">
                <div class="controller-title">P2B8</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="pots-section">
                ${potsHTML}
            </div>
            <div class="buttons-section">
                ${buttonsHTML}
            </div>
        </div>
    `;
  }

  private generateP10HTML(controller: ControllerInPatch): string {
    // P10: P.1-P.2 are large pots, P.3-P.10 are mini pots
    const largePotLabels = [1, 2].map((idx) =>
      controller.labels.find((l) => l.register === `P${controller.number}.${idx}`)
    );
    const miniPotLabels = [3, 4, 5, 6, 7, 8, 9, 10].map((idx) =>
      controller.labels.find((l) => l.register === `P${controller.number}.${idx}`)
    );

    const largePotsHTML = largePotLabels
      .map(
        (label, idx) => {
          const register = `P${controller.number}.${idx + 1}`;
          const shortLabel = label?.short ? label.short.substring(0, 5) : "";
          const tooltipText = label?.long ? `${register} – ${label.long}` : register;
          return `
        <div class="pot-container element" data-register="${register}">
            <div class="pot">
                <div class="pot-indicator"></div>
                ${shortLabel ? `<div class="pot-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            </div>
            <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
        }
      )
      .join("");

    const miniPotsHTML = miniPotLabels
      .map(
        (label, idx) => {
          const num = idx + 3; // P.3 to P.10
          const register = `P${controller.number}.${num}`;
          const shortLabel = label?.short ? label.short.substring(0, 5) : "";
          const tooltipText = label?.long ? `${register} – ${label.long}` : register;
          return `
        <div class="mini-pot-container element" data-register="${register}">
            <span class="mini-pot-number">${num}</span>
            <div class="mini-pot">
                <div class="mini-pot-indicator"></div>
                ${shortLabel ? `<div class="mini-pot-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            </div>
            <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
        }
      )
      .join("");

    return `
        <div class="controller">
            <div class="controller-header">
                <div class="controller-title">P10</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="pots-section">
                ${largePotsHTML}
            </div>
            <div class="mini-pots-section">
                ${miniPotsHTML}
            </div>
        </div>
    `;
  }

  private generateS10HTML(controller: ControllerInPatch): string {
    // S10: S.1-S.2 are 8-position rotary switches, S.3-S.10 are 3-position toggle switches
    const rotarySwitchLabels = [1, 2].map((idx) =>
      controller.labels.find((l) => l.register === `S${controller.number}.${idx}`)
    );
    const miniSwitchLabels = [3, 4, 5, 6, 7, 8, 9, 10].map((idx) =>
      controller.labels.find((l) => l.register === `S${controller.number}.${idx}`)
    );

    const rotarySwitchesHTML = rotarySwitchLabels
      .map(
        (label, idx) => {
          const register = `S${controller.number}.${idx + 1}`;
          const shortLabel = label?.short ? label.short.substring(0, 5) : "";
          const tooltipText = label?.long ? `${register} – ${label.long}` : register;
          return `
        <div class="pot-container element" data-register="${register}">
            <div class="rotary-switch">
                <div class="rotary-switch-indicator"></div>
                ${shortLabel ? `<div class="rotary-switch-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            </div>
            <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
        }
      )
      .join("");

    const miniSwitchesHTML = miniSwitchLabels
      .map(
        (label, idx) => {
          const num = idx + 3; // S.3 to S.10
          const register = `S${controller.number}.${num}`;
          const shortLabel = label?.short ? label.short.substring(0, 5) : "";
          const tooltipText = label?.long ? `${register} – ${label.long}` : register;
          return `
        <div class="mini-switch-container element" data-register="${register}">
            <span class="mini-switch-number">${num}</span>
            <div class="mini-switch">
                ${shortLabel ? `<div class="mini-switch-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            </div>
            <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
        }
      )
      .join("");

    return `
        <div class="controller">
            <div class="controller-header">
                <div class="controller-title">S10</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="pots-section">
                ${rotarySwitchesHTML}
            </div>
            <div class="mini-switches-section">
                ${miniSwitchesHTML}
            </div>
        </div>
    `;
  }

  private generateMaster16HTML(masterLabels: LabelInfo[]): string {
    // Generate 4x4 LED matrix
    const ledMatrixHTML = Array.from({ length: 16 }, (_, i) => 
      `<div class="master-led"></div>`
    ).join("");
    
    // Generate 16 IO jacks (4x4 grid) - first 8 are inputs, last 8 are outputs
    const ioJacks = Array.from({ length: 16 }, (_, i) => {
      const isInput = i < 8;
      const ioNum = (i % 8) + 1;
      const register = isInput ? `I${ioNum}` : `O${ioNum}`;
      const label = masterLabels.find((l) => l.register === register);
      const shortLabel = label?.short ? label.short.substring(0, 5) : "";
      
      const tooltipText = label?.long ? `${register} – ${label.long}` : register;
      
      return `<div class="master-io-jack element" data-register="${register}">
        ${shortLabel ? `<div class="master-io-label">${this.escapeHtml(shortLabel)}</div>` : ""}
        <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
      </div>`;
    }).join("");
    
    // Generate display segments (7-segment style display)
    const displaySegments = Array.from({ length: 12 }, () => 
      `<div class="master-display-segment"></div>`
    ).join("");

    return `
        <div class="master-container">
            <div class="master">
                <div class="master-header">
                    <div class="master-title">DROID</div>
                    <div class="master-subtitle">MASTER</div>
                </div>
                <div class="master-top">
                    <div class="master-pot"></div>
                    <div class="master-display">
                        ${displaySegments}
                    </div>
                </div>
                <div class="master-led-matrix">
                    ${ledMatrixHTML}
                </div>
                <div class="master-io-section">
                    ${ioJacks}
                </div>
            </div>
        </div>
    `;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
