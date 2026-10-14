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

export interface ExpanderJack {
  register: string;
  label?: LabelInfo;
}

/** A referenced G8 expander instance (1..4) with its 8 jacks and 8 LEDs. */
export interface G8Instance {
  instance: number; // display index 1..4 (order in the chain of G8s)
  group: number; // dotted register group (master-dependent: G<group>.x)
  jacks: ExpanderJack[]; // 8 gate jacks
  leds: { register: string; index: number; label?: LabelInfo }[]; // 8 LED squares
}

/** The X7 expander: 4 gate outputs (G9-G12) and 8 LED squares (R49-R56). */
export interface X7Info {
  jacks: ExpanderJack[]; // G9..G12
  leds: { register: string; index: number; label?: LabelInfo }[]; // R49..R56
}

/**
 * Parse the patch text to extract:
 * 1. The controller chain (sequence of [controller-type] declarations)
 * 2. The label legend (# INPUTS, # OUTPUTS, # CONTROLLER N sections)
 * 3. The master type (master=16 or master=18)
 */
export class PatchParser {
  constructor(private data: DroidData) {}

  parse(text: string): {
    controllers: ControllerInPatch[];
    master: string;
    masterLabels: LabelInfo[];
    g8: G8Instance[];
    x7: X7Info | null;
  } {
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
      masterLabels: labels.filter((lab) => /^[IOG]\d+$/.test(lab.register)),
      g8: this.detectG8(text, master, labels),
      x7: this.detectX7(text, labels),
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

  /**
   * Detects which G8 expander instances (1..4) are referenced anywhere in the
   * patch — in the label legend or in the circuit code — and builds their jack
   * and LED registers. Up to four G8s can be chained; which dotted group maps
   * to which instance depends on the master:
   *   - master 16: 1st G8 = G1.x, 2nd = G2.x, 3rd = G3.x, 4th = G4.x
   *               (and plain G1..G8 are the 1st G8, since G1 == G1.1).
   *   - master 18: 1st G8 = G2.x, 2nd = G3.x, 3rd = G4.x, 4th = G5.x
   *               (plain G1..G4 are the master's own gate outputs).
   * Each G8 also owns 8 LED squares: instance i -> R(17+(i-1)*8) … +7.
   */
  private detectG8(text: string, master: string, labels: LabelInfo[]): G8Instance[] {
    const m18 = master === "master18";
    const referenced = new Set<number>(); // display indices 1..4

    const groupToInstance = (g: number): number | null => {
      if (m18) return g >= 2 && g <= 5 ? g - 1 : null;
      return g >= 1 && g <= 4 ? g : null;
    };

    // G jacks: dotted (G<g>.<e>) and, on master 16, plain G1..G8 (= 1st G8).
    const gRe = /\bG(\d+)(?:\.(\d+))?\b/g;
    let mt: RegExpExecArray | null;
    while ((mt = gRe.exec(text))) {
      const a = Number(mt[1]);
      const e = mt[2] !== undefined ? Number(mt[2]) : null;
      if (e !== null) {
        const inst = groupToInstance(a);
        if (inst && e >= 1 && e <= 8) referenced.add(inst);
      } else if (!m18 && a >= 1 && a <= 8) {
        referenced.add(1);
      }
    }

    // LED squares R17..R48 belong to the G8s (8 per instance).
    const rRe = /\bR(\d+)\b/g;
    while ((mt = rRe.exec(text))) {
      const r = Number(mt[1]);
      if (r >= 17 && r <= 48) referenced.add(Math.floor((r - 17) / 8) + 1);
    }

    const findLabel = (...regs: (string | undefined)[]) =>
      labels.find((l) => regs.some((r) => r && l.register === r));

    return Array.from(referenced)
      .sort((x, y) => x - y)
      .map((instance) => {
        const group = m18 ? instance + 1 : instance;
        const jacks: ExpanderJack[] = [];
        for (let j = 1; j <= 8; j++) {
          const register = `G${group}.${j}`;
          // On master 16 the 1st G8's jacks can also be written plain (G1..G8).
          const alias = !m18 && instance === 1 ? `G${j}` : undefined;
          jacks.push({ register, label: findLabel(register, alias) });
        }
        const leds = [];
        for (let k = 1; k <= 8; k++) {
          const register = `R${17 + (instance - 1) * 8 + (k - 1)}`;
          leds.push({ register, index: k, label: findLabel(register) });
        }
        return { instance, group, jacks, leds };
      });
  }

  /**
   * Detects the X7 expander: shown when any of its registers is referenced in
   * the patch — the four gate outputs G9..G12 or its LED squares R49..R56.
   */
  private detectX7(text: string, labels: LabelInfo[]): X7Info | null {
    const referenced =
      /\bG(9|10|11|12)\b/.test(text) || /\bR(49|5[0-6])\b/.test(text);
    if (!referenced) return null;

    const findLabel = (reg: string) => labels.find((l) => l.register === reg);

    const jacks: ExpanderJack[] = [];
    for (let n = 9; n <= 12; n++) {
      const register = `G${n}`;
      jacks.push({ register, label: findLabel(register) });
    }
    const leds = [];
    for (let k = 1; k <= 8; k++) {
      const register = `R${48 + k}`;
      leds.push({ register, index: k, label: findLabel(register) });
    }
    return { jacks, leds };
  }
}

/**
 * Manages the hardware view webview panel.
 */
export class HardwareViewProvider {
  static readonly viewType = "droidHardwareView";

  private panel: vscode.WebviewPanel | undefined;
  private document: vscode.TextDocument | undefined;
  private changeSub: vscode.Disposable | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private data: DroidData
  ) {}

  show() {
    const editor = vscode.window.activeTextEditor;
    // .ini patches and .droider patches (which may use megacircuits) both
    // declare a controller chain, so the hardware view supports both.
    if (!editor || !["droid", "droider"].includes(editor.document.languageId)) {
      vscode.window.showInformationMessage("Open a DROID patch (.ini or .droider) first");
      return;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.adopt(
        vscode.window.createWebviewPanel(
          HardwareViewProvider.viewType,
          "DROID Hardware",
          vscode.ViewColumn.Beside,
          { enableScripts: true, retainContextWhenHidden: true }
        )
      );
    }

    this.setDocument(editor.document);
  }

  /**
   * Revive a panel restored by VSCode after a window reload. The originating
   * document is recovered from the persisted webview state (its URI); if that
   * fails we fall back to any open DROID patch (.ini or .droider) so the pane
   * is never left blank.
   */
  async restore(panel: vscode.WebviewPanel, state: unknown) {
    this.adopt(panel);
    const document = await this.documentFromState(state);
    if (document) this.setDocument(document);
  }

  /** Wire up a (new or revived) panel: lifecycle, messages, live updates. */
  private adopt(panel: vscode.WebviewPanel) {
    this.panel = panel;
    // A revived panel comes back with scripts disabled; re-enable them.
    panel.webview.options = { enableScripts: true };

    panel.onDidDispose(() => {
      this.panel = undefined;
      this.document = undefined;
      this.changeSub?.dispose();
      this.changeSub = undefined;
    });

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === "copy") {
        await vscode.env.clipboard.writeText(message.text);
      }
    });

    // Update when the source document changes
    this.changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (this.document && e.document === this.document && this.panel) {
        this.updateContent(e.document);
      }
    });
  }

  private setDocument(document: vscode.TextDocument) {
    this.document = document;
    this.updateContent(document);
  }

  private async documentFromState(
    state: unknown
  ): Promise<vscode.TextDocument | undefined> {
    const uri =
      state && typeof (state as { uri?: unknown }).uri === "string"
        ? (state as { uri: string }).uri
        : undefined;
    if (uri) {
      try {
        return await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      } catch {
        /* fall through to a sensible default */
      }
    }
    const active = vscode.window.activeTextEditor;
    if (active && ["droid", "droider"].includes(active.document.languageId)) {
      return active.document;
    }
    return vscode.workspace.textDocuments.find((d) =>
      ["droid", "droider"].includes(d.languageId)
    );
  }

  private updateContent(document: vscode.TextDocument) {
    if (!this.panel) return;

    const parser = new PatchParser(this.data);
    const { controllers, master, masterLabels, g8, x7 } = parser.parse(document.getText());

    this.panel.webview.html = this.generateHTML(
      controllers,
      master,
      masterLabels,
      g8,
      x7,
      document.uri.toString()
    );
  }

  private generateHTML(
    controllers: ControllerInPatch[],
    masterType: string,
    masterLabels: LabelInfo[],
    g8: G8Instance[],
    x7: X7Info | null,
    docUri: string
  ): string {
    const masterHTML =
      masterType === "master18"
        ? this.generateMaster18HTML(masterLabels)
        : this.generateMaster16HTML(masterLabels);
    
    const controllersHTML = controllers
      .map((ctrl) => {
        if (ctrl.type === "p2b8") return this.generateP2B8HTML(ctrl);
        if (ctrl.type === "p4b2") return this.generateP4B2HTML(ctrl);
        if (ctrl.type === "p10") return this.generateP10HTML(ctrl);
        if (ctrl.type === "s10") return this.generateS10HTML(ctrl);
        if (ctrl.type === "b32") return this.generateB32HTML(ctrl);
        if (ctrl.type === "p8s8") return this.generateP8S8HTML(ctrl);
        if (ctrl.type === "e4") return this.generateE4HTML(ctrl);
        if (ctrl.type === "m4") return this.generateM4HTML(ctrl);
        if (ctrl.type === "db8e") return this.generateDB8EHTML(ctrl);
        return "";
      })
      .filter((html) => html !== "")
      .join("\n");

    const expandersHTML =
      g8.map((inst) => this.generateG8HTML(inst)).join("\n") +
      (x7 ? "\n" + this.generateX7HTML(x7) : "");

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
            white-space: nowrap;
            background: rgba(212, 184, 150, 0.95);
            padding: 2px 4px;
            border-radius: 2px;
            border: 1px solid rgba(180, 154, 120, 0.8);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            line-height: 1;
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

        /* B32: wider controller with a 4-column button grid */
        .controller.wide {
            width: 150px;
        }

        .b32-buttons-section {
            display: grid;
            grid-template-columns: repeat(4, 28px);
            justify-items: center;
            align-items: center;
            gap: 22px 8px;
            margin: 10px 0;
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
            transition: transform 0.2s;
        }
        
        .mini-pot:hover {
            transform: scale(1.05);
            transition: transform 0.2s;
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
            white-space: nowrap;
            background: rgba(212, 184, 150, 0.95);
            padding: 2px 4px;
            border-radius: 2px;
            border: 1px solid rgba(180, 154, 120, 0.8);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            line-height: 1;
        }

        .rotary-switch:hover {
            transform: scale(1.05);
            transition: transform 0.2s;
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
            transition: transform 0.2s;
        }

        /* P8S8 Faders */
        .faders-section {
            display: grid;
            grid-template-columns: repeat(4, 30px);
            gap: 16px 14px;
            justify-items: center;
            margin: 12px 0;
        }

        .fader-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
        }

        .fader-number {
            font-size: 11px;
            color: #d4b896;
            margin-bottom: 4px;
            font-weight: normal;
        }

        .fader-track {
            width: 18px;
            height: 120px;
            background: linear-gradient(to bottom, #1a1a1a, #0a0a0a);
            border: 2px solid #3a3a3a;
            border-radius: 3px;
            position: relative;
            cursor: pointer;
            box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7);
        }

        .fader-fill {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 32%;
            background: linear-gradient(to top, #c46a10, #e8861f);
            border-radius: 0 0 1px 1px;
        }

        .fader-handle {
            position: absolute;
            bottom: 26%;
            left: 50%;
            transform: translateX(-50%);
            width: 22px;
            height: 16px;
            background: linear-gradient(to bottom, #f0a040, #b85f0c);
            border: 1px solid #7a3d05;
            border-radius: 2px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
            z-index: 2;
        }

        .fader-label {
            position: absolute;
            bottom: -16px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 8px;
            font-weight: bold;
            color: #1a1a1a;
            white-space: nowrap;
            text-align: center;
            background: rgba(212, 184, 150, 0.95);
            padding: 2px 4px;
            border-radius: 2px;
            border: 1px solid rgba(180, 154, 120, 0.8);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            line-height: 1;
        }

        .fader-track:hover {
            transform: scale(1.05);
            transition: transform 0.2s;
        }

        /* P8S8 switches: 4-column variant of the S10 toggle grid */
        .p8s8-switches-section {
            display: grid;
            grid-template-columns: repeat(4, 28px);
            gap: 8px 14px;
            justify-items: center;
            align-items: center;
            row-gap: 18px;
            margin-top: 24px;
        }

        /* E4 Encoders */
        .e4-encoders-section {
            display: flex;
            flex-direction: column;
            gap: 18px;
            margin: 14px 0;
            align-items: center;
        }

        .encoder-cell {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
        }

        .led-ring {
            width: 74px;
            height: 74px;
            border: 5px dashed #d4b896;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        }

        .encoder-number {
            position: absolute;
            top: 3px;
            left: 7px;
            font-size: 12px;
            color: #d4b896;
            font-weight: normal;
            z-index: 4;
        }

        .encoder-knob {
            width: 50px;
            height: 50px;
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

        .encoder-knob::after {
            content: '';
            position: absolute;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, #f5f5f5, #c0c0c0);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.5);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }

        .encoder-knob:hover {
            transform: scale(1.05);
            transition: transform 0.2s;
        }

        /* M4 motorized faders */
        .m4-faders-section {
            display: grid;
            grid-template-columns: repeat(4, 32px);
            gap: 12px;
            justify-items: center;
            margin: 14px 0 8px 0;
        }

        .m4-fader-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
        }

        .m4-fader-number {
            font-size: 11px;
            color: #d4b896;
            margin-bottom: 6px;
            font-weight: normal;
        }

        .m4-fader-track {
            width: 6px;
            height: 300px;
            background: #050505;
            border-radius: 3px;
            position: relative;
            cursor: pointer;
            display: flex;
            justify-content: center;
            box-shadow: inset 0 0 4px rgba(0, 0, 0, 0.9);
        }

        .m4-fader-handle {
            position: absolute;
            bottom: 4%;
            left: 50%;
            transform: translateX(-50%);
            width: 30px;
            height: 58px;
            border: 1px solid #777;
            border-radius: 3px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.7);
            background:
                repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.10) 0 3px, transparent 3px 7px),
                linear-gradient(to right, #8a8a8a, #f5f5f5 30%, #cfcfcf 50%, #f5f5f5 70%, #8a8a8a);
            z-index: 2;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* dark notch line across the middle of the cap */
        .m4-fader-handle::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 2px;
            background: #1a1a1a;
            transform: translateY(-50%);
        }

        .m4-fader-label {
            position: relative;
            z-index: 3;
            font-size: 8px;
            font-weight: bold;
            color: #1a1a1a;
            white-space: nowrap;
            background: rgba(212, 184, 150, 0.95);
            padding: 2px 4px;
            border-radius: 2px;
            border: 1px solid rgba(180, 154, 120, 0.8);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            line-height: 1;
        }

        .m4-fader-track:hover {
            transform: scaleX(1.4);
            transition: transform 0.2s;
        }

        /* DB8E */
        .db8e-display {
            width: 60px;
            height: 38px;
            background: linear-gradient(to bottom, #1a1a1a, #0a0a0a);
            border: 2px solid #d4b896;
            border-radius: 3px;
            margin: 6px 0 14px 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 7px;
            color: #6a6a6a;
            letter-spacing: 1px;
            box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.8);
        }

        .db8e-encoder-section {
            margin-top: 16px;
            display: flex;
            justify-content: center;
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
            transition: transform 0.2s;
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
            white-space: nowrap;
            z-index: 1;
            background: rgba(212, 184, 150, 0.95);
            padding: 2px 4px;
            border-radius: 2px;
            border: 1px solid rgba(180, 154, 120, 0.8);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            line-height: 1;
        }
        
        /* Master 18 */
        .master.master18 {
            width: 120px;
        }

        .master18-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            margin-bottom: 10px;
            gap: 8px;
        }

        .m18-led {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, #e0e0e0, #a8a8a8);
            border: 2px solid #d4b896;
            box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.4);
        }

        .m18-sd {
            width: 22px;
            height: 30px;
            background: linear-gradient(to bottom, #3a3a3a, #2a2a2a);
            border: 1px solid #d4b896;
            border-radius: 2px 2px 4px 4px;
        }

        .m18-toggle {
            width: 28px;
            height: 18px;
            background: linear-gradient(to bottom, #4a4a4a, #2a2a2a);
            border: 2px solid #5a5a5a;
            border-radius: 9px;
            position: relative;
        }

        .m18-toggle::after {
            content: '';
            position: absolute;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, #f0f0f0, #b0b0b0);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        }

        .m18-usb {
            width: 26px;
            height: 14px;
            background: linear-gradient(to bottom, #1a1a1a, #0a0a0a);
            border: 2px solid #888;
            border-radius: 7px;
        }

        .master18-jacks {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px 4px;
            width: 100%;
        }

        .master18-cell {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 3px;
            position: relative;
        }

        .master18-printed {
            font-size: 9px;
            color: #d4b896;
            font-weight: normal;
        }

        /* G8 expander */
        .g8-led-matrix {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 4px;
            width: 100%;
            margin: 8px 0 16px 0;
        }

        .g8-led {
            position: relative;
            aspect-ratio: 1 / 1;
            background: linear-gradient(135deg, #b29c5c, #8c7a42);
            border: 1px solid #d4b896;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }

        .g8-led:hover {
            transform: scale(1.05);
            transition: transform 0.2s;
        }

        .g8-led-number {
            font-size: 16px;
            font-weight: bold;
            color: #2a2410;
            font-family: monospace;
        }

        .g8-jacks {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 14px 4px;
            width: 100%;
        }

        .g8-jack-cell {
            display: flex;
            justify-content: center;
            position: relative;
        }

        /* X7 expander */
        .x7-center {
            display: flex;
            justify-content: center;
            margin: 8px 0;
        }

        .x7-section-label {
            font-size: 9px;
            color: #d4b896;
            letter-spacing: 1px;
            margin: 12px 0 6px 0;
            text-align: center;
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
            white-space: nowrap;
            background: rgba(212, 184, 150, 0.95);
            padding: 2px 4px;
            border-radius: 2px;
            border: 1px solid rgba(180, 154, 120, 0.8);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            line-height: 1;
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
            z-index: 99999;
            max-width: 400px;
            min-width: 100px;
            font-size: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
            word-wrap: break-word;
            white-space: normal;
            line-height: 1.4;
        }

        /*
         * Capsule labels (e.g. .pot-label, .button-label) use transform,
         * which makes each one its own stacking context painted at the same
         * level as its sibling elements. A tooltip's high z-index only wins
         * inside its OWN element's stacking context, so a neighbouring
         * element's capsule could still paint on top of it. Lifting the whole
         * hovered element above its siblings guarantees its tooltip (and the
         * tooltip's z-index) outrank every other element's capsule label.
         *
         * NOTE: hover transitions must animate transform only, never "all".
         * On controls where this lift lands on the same node that scales on
         * hover (e.g. .element.button), a "transition: all" would also animate
         * z-index — a discrete auto-to-99999 flip that only takes effect at the
         * midpoint of the transition. During that delay the scale transform has
         * already created a stacking context but the dominating z-index has not
         * applied yet, so neighbouring controls' number labels paint over the
         * tooltip.
         */
        .element:hover,
        .pot-container:hover {
            z-index: 99999;
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
        ${expandersHTML}
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
            // Persist the source document URI so the pane can be revived with
            // its content after a window reload (WebviewPanelSerializer).
            vscode.setState(${JSON.stringify({ uri: docUri })});
            const notification = document.getElementById('copyNotification');
            let hideTimeout;

            // Tooltips are centered over their element (left: 50%; translateX(-50%)).
            // For elements near the window edges that centred position overflows the
            // viewport and the tooltip gets clipped. On hover, measure the tooltip and
            // shift it horizontally so it stays fully inside the visible window.
            const MARGIN = 6;
            function positionTooltip(tooltip) {
                // Reset to the default centred position before measuring.
                tooltip.style.transform = 'translateX(-50%)';
                const rect = tooltip.getBoundingClientRect();
                let shift = 0;
                if (rect.left < MARGIN) {
                    shift = MARGIN - rect.left;
                } else if (rect.right > window.innerWidth - MARGIN) {
                    shift = (window.innerWidth - MARGIN) - rect.right;
                }
                if (shift !== 0) {
                    tooltip.style.transform = 'translateX(-50%) translateX(' + shift + 'px)';
                }
            }

            document.addEventListener('mouseover', function(e) {
                const element = e.target.closest('.element, .pot-container');
                if (!element) return;
                const tooltip = element.querySelector(':scope > .tooltip');
                if (tooltip) positionTooltip(tooltip);
            });

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

  private generateP4B2HTML(controller: ControllerInPatch): string {
    // P4B2: P.1-P.4 are large pots, B.1-B.2 are buttons.
    const potLabels = [1, 2, 3, 4].map((idx) =>
      controller.labels.find((l) => l.register === `P${controller.number}.${idx}`)
    );
    const buttonLabels = [1, 2].map((idx) =>
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
                <div class="controller-title">P4B2</div>
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

  private generateDB8EHTML(controller: ControllerInPatch): string {
    // DB8E: a display (decorative), 8 push buttons (B.1-B.8) and one rotary
    // encoder (E.1) with an LED ring.
    const buttonsHTML = Array.from({ length: 8 }, (_, idx) => {
      const num = idx + 1;
      const register = `B${controller.number}.${num}`;
      const label = controller.labels.find((l) => l.register === register);
      const shortLabel = label?.short ? label.short.substring(0, 5) : "";
      const tooltipText = label?.long ? `${register} – ${label.long}` : register;
      return `
        <div class="element button" data-register="${register}">
            <span class="button-number">${num}</span>
            ${shortLabel ? `<div class="button-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
    }).join("");

    const encReg = `E${controller.number}.1`;
    const encLabel = controller.labels.find((l) => l.register === encReg);
    const encShort = encLabel?.short ? encLabel.short.substring(0, 5) : "";
    const encTip = encLabel?.long ? `${encReg} – ${encLabel.long}` : encReg;

    return `
        <div class="controller">
            <div class="controller-header">
                <div class="controller-title">DB8E</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="db8e-display">DISPLAY</div>
            <div class="buttons-section">
                ${buttonsHTML}
            </div>
            <div class="db8e-encoder-section">
                <div class="led-ring">
                    <div class="encoder-knob element" data-register="${encReg}">
                        <div class="pot-indicator"></div>
                        ${encShort ? `<div class="pot-label">${this.escapeHtml(encShort)}</div>` : ""}
                        <div class="tooltip" style="position: absolute; bottom: 115%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(encTip)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;
  }

  private generateM4HTML(controller: ControllerInPatch): string {
    // M4: 4 tall motorized faders (P.1-P.4), each with a touch plate (B.1-B.4).
    // Like the E4, one element per fader: clicking copies P.n, the tooltip
    // shows both the fader (P.n) and touch-plate (B.n) labels.
    const fadersHTML = Array.from({ length: 4 }, (_, idx) => {
      const num = idx + 1;
      const fadReg = `P${controller.number}.${num}`;
      const btnReg = `B${controller.number}.${num}`;
      const fadLabel = controller.labels.find((l) => l.register === fadReg);
      const btnLabel = controller.labels.find((l) => l.register === btnReg);
      const shortLabel = fadLabel?.short ? fadLabel.short.substring(0, 5) : "";
      const fadTip = fadLabel?.long ? `${fadReg} – ${fadLabel.long}` : fadReg;
      const btnTip = btnLabel?.long ? `${btnReg} – ${btnLabel.long}` : btnReg;
      const tooltip = `${this.escapeHtml(fadTip)}<br>${this.escapeHtml(btnTip)}`;
      return `
        <div class="m4-fader-container element" data-register="${fadReg}">
            <span class="m4-fader-number">${num}</span>
            <div class="m4-fader-track">
                <div class="m4-fader-handle">
                    ${shortLabel ? `<span class="m4-fader-label">${this.escapeHtml(shortLabel)}</span>` : ""}
                </div>
            </div>
            <div class="tooltip" style="position: absolute; bottom: 102%; left: 50%; transform: translateX(-50%);">${tooltip}</div>
        </div>
    `;
    }).join("");

    return `
        <div class="controller wide">
            <div class="controller-header">
                <div class="controller-title">M4</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="m4-faders-section">
                ${fadersHTML}
            </div>
        </div>
    `;
  }

  private generateE4HTML(controller: ControllerInPatch): string {
    // E4: 4 push encoders (E.1-E.4) each inside an LED ring, with a push
    // button (B.1-B.4). The encoder ring is decorative; clicking the knob
    // copies E.n, clicking the "push" pill copies B.n.
    const cellsHTML = Array.from({ length: 4 }, (_, idx) => {
      const num = idx + 1;
      const encReg = `E${controller.number}.${num}`;
      const btnReg = `B${controller.number}.${num}`;
      const encLabel = controller.labels.find((l) => l.register === encReg);
      const btnLabel = controller.labels.find((l) => l.register === btnReg);
      const encShort = encLabel?.short ? encLabel.short.substring(0, 5) : "";
      const encTip = encLabel?.long ? `${encReg} – ${encLabel.long}` : encReg;
      const btnTip = btnLabel?.long ? `${btnReg} – ${btnLabel.long}` : btnReg;
      const tooltip = `${this.escapeHtml(encTip)}<br>${this.escapeHtml(btnTip)}`;
      return `
        <div class="encoder-cell">
            <div class="led-ring">
                <span class="encoder-number">${num}</span>
                <div class="encoder-knob element" data-register="${encReg}">
                    <div class="pot-indicator"></div>
                    ${encShort ? `<div class="pot-label">${this.escapeHtml(encShort)}</div>` : ""}
                    <div class="tooltip" style="position: absolute; bottom: 115%; left: 50%; transform: translateX(-50%);">${tooltip}</div>
                </div>
            </div>
        </div>
    `;
    }).join("");

    return `
        <div class="controller">
            <div class="controller-header">
                <div class="controller-title">E4</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="e4-encoders-section">
                ${cellsHTML}
            </div>
        </div>
    `;
  }

  private generateP8S8HTML(controller: ControllerInPatch): string {
    // P8S8: P.1-P.8 are faders (sliders), S.1-S.8 are 3-position toggle switches.
    const fadersHTML = Array.from({ length: 8 }, (_, idx) => {
      const num = idx + 1;
      const register = `P${controller.number}.${num}`;
      const label = controller.labels.find((l) => l.register === register);
      const shortLabel = label?.short ? label.short.substring(0, 5) : "";
      const tooltipText = label?.long ? `${register} – ${label.long}` : register;
      return `
        <div class="fader-container element" data-register="${register}">
            <span class="fader-number">${num}</span>
            <div class="fader-track">
                <div class="fader-fill"></div>
                <div class="fader-handle"></div>
            </div>
            ${shortLabel ? `<div class="fader-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            <div class="tooltip" style="position: absolute; bottom: 105%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
    }).join("");

    const switchesHTML = Array.from({ length: 8 }, (_, idx) => {
      const num = idx + 1;
      const register = `S${controller.number}.${num}`;
      const label = controller.labels.find((l) => l.register === register);
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
    }).join("");

    return `
        <div class="controller wide">
            <div class="controller-header">
                <div class="controller-title">P8S8</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="faders-section">
                ${fadersHTML}
            </div>
            <div class="p8s8-switches-section">
                ${switchesHTML}
            </div>
        </div>
    `;
  }

  private generateB32HTML(controller: ControllerInPatch): string {
    // B32: 32 buttons (B.1-B.32) in a 4-column x 8-row grid.
    const buttonsHTML = Array.from({ length: 32 }, (_, idx) => {
      const num = idx + 1;
      const register = `B${controller.number}.${num}`;
      const label = controller.labels.find((l) => l.register === register);
      const shortLabel = label?.short ? label.short.substring(0, 5) : "";
      const tooltipText = label?.long ? `${register} – ${label.long}` : register;
      return `
        <div class="element button" data-register="${register}">
            <span class="button-number">${num}</span>
            ${shortLabel ? `<div class="button-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
        </div>
    `;
    }).join("");

    return `
        <div class="controller wide">
            <div class="controller-header">
                <div class="controller-title">B32</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="b32-buttons-section">
                ${buttonsHTML}
            </div>
        </div>
    `;
  }

  private generateX7HTML(x7: X7Info): string {
    // X7: a mode toggle + USB-C (decorative), 8 LED squares (R49-R56), a MIDI
    // TRS in/out pair (decorative) and 4 gate outputs (G9-G12).
    const ledsHTML = x7.leds
      .map((led) => {
        const tip = led.label?.long ? `${led.register} – ${led.label.long}` : led.register;
        return `
        <div class="g8-led element" data-register="${led.register}">
            <span class="g8-led-number">${led.index}</span>
            <div class="tooltip" style="position: absolute; bottom: 110%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tip)}</div>
        </div>
    `;
      })
      .join("");

    const gatesHTML = x7.jacks
      .map((jk) => {
        const shortLabel = jk.label?.short ? jk.label.short.substring(0, 5) : "";
        const tip = jk.label?.long ? `${jk.register} – ${jk.label.long}` : jk.register;
        return `
        <div class="g8-jack-cell element" data-register="${jk.register}">
            <div class="master-io-jack">
                ${shortLabel ? `<div class="master-io-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            </div>
            <div class="tooltip" style="position: absolute; bottom: 115%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tip)}</div>
        </div>
    `;
      })
      .join("");

    // Two decorative MIDI TRS jacks (physical ports, not patchable registers).
    const midiJack = `
        <div class="g8-jack-cell">
            <div class="master-io-jack"></div>
        </div>
    `;

    return `
        <div class="controller">
            <div class="controller-header">
                <div class="controller-title">X7</div>
                <div class="controller-subtitle">DROID</div>
            </div>
            <div class="x7-center"><div class="m18-toggle"></div></div>
            <div class="g8-led-matrix">
                ${ledsHTML}
            </div>
            <div class="x7-center"><div class="m18-usb"></div></div>
            <div class="x7-section-label">IN MIDI OUT</div>
            <div class="g8-jacks">
                ${midiJack}${midiJack}
            </div>
            <div class="x7-section-label">GATES</div>
            <div class="g8-jacks">
                ${gatesHTML}
            </div>
        </div>
    `;
  }

  private generateG8HTML(g8: G8Instance): string {
    // G8: a 2x4 block of 8 LED squares (numbered 1-8 = registers R..) and 8
    // gate jacks (G<group>.1 … G<group>.8) in a 2x4 grid.
    const ledsHTML = g8.leds
      .map((led) => {
        const tip = led.label?.long ? `${led.register} – ${led.label.long}` : led.register;
        return `
        <div class="g8-led element" data-register="${led.register}">
            <span class="g8-led-number">${led.index}</span>
            <div class="tooltip" style="position: absolute; bottom: 110%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tip)}</div>
        </div>
    `;
      })
      .join("");

    const jacksHTML = g8.jacks
      .map((jk) => {
        const shortLabel = jk.label?.short ? jk.label.short.substring(0, 5) : "";
        const tip = jk.label?.long ? `${jk.register} – ${jk.label.long}` : jk.register;
        return `
        <div class="g8-jack-cell element" data-register="${jk.register}">
            <div class="master-io-jack">
                ${shortLabel ? `<div class="master-io-label">${this.escapeHtml(shortLabel)}</div>` : ""}
            </div>
            <div class="tooltip" style="position: absolute; bottom: 115%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tip)}</div>
        </div>
    `;
      })
      .join("");

    return `
        <div class="controller">
            <div class="controller-header">
                <div class="controller-title">G8</div>
                <div class="controller-subtitle">G${g8.group}.x</div>
            </div>
            <div class="g8-led-matrix">
                ${ledsHTML}
            </div>
            <div class="g8-jacks">
                ${jacksHTML}
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

  private generateMaster18HTML(masterLabels: LabelInfo[]): string {
    // MASTER18: 18 jacks in a 3x6 grid. Two gate inputs (I1-I2), four gate
    // outputs (G1-G4), eight CV outputs (O1-O8), plus two MIDI TRS pairs
    // (decorative: the MIDI ports are not patchable registers).
    const jack = (reg: string) => {
      const label = masterLabels.find((l) => l.register === reg);
      const shortLabel = label?.short ? label.short.substring(0, 5) : "";
      const tooltipText = label?.long ? `${reg} – ${label.long}` : reg;
      return `
        <div class="master18-cell">
            <span class="master18-printed">${reg}</span>
            <div class="master-io-jack element" data-register="${reg}">
                ${shortLabel ? `<div class="master-io-label">${this.escapeHtml(shortLabel)}</div>` : ""}
                <div class="tooltip" style="position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);">${this.escapeHtml(tooltipText)}</div>
            </div>
        </div>
    `;
    };

    // A MIDI TRS jack: physical port, not a patchable register.
    const midi = (name: string) => `
        <div class="master18-cell">
            <span class="master18-printed">${name}</span>
            <div class="master-io-jack"></div>
        </div>
    `;

    const cells = [
      jack("I1"), midi("MIDI1"), midi("MIDI1"),
      jack("I2"), midi("MIDI2"), midi("MIDI2"),
      jack("G1"), jack("O1"), jack("O2"),
      jack("G2"), jack("O3"), jack("O4"),
      jack("G3"), jack("O5"), jack("O6"),
      jack("G4"), jack("O7"), jack("O8"),
    ].join("");

    return `
        <div class="master-container">
            <div class="master master18">
                <div class="master-header">
                    <div class="master-title">DROID</div>
                    <div class="master-subtitle">MASTER18</div>
                </div>
                <div class="master18-top">
                    <div class="m18-led"></div>
                    <div class="m18-sd"></div>
                </div>
                <div class="master18-top">
                    <div class="m18-toggle"></div>
                    <div class="m18-usb"></div>
                </div>
                <div class="master18-jacks">
                    ${cells}
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
