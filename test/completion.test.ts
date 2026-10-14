import { test } from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { DroidData } from "../src/data";
import type { BlueprintRegistry } from "../src/blueprintRegistry";
import { parseBlueprint } from "../src/blueprints";

// Exercise the real provider in Node with only the VS Code value objects
// replaced; no editor host is needed to check filtering and replacement ranges.
class Position {
  constructor(readonly line: number, readonly character: number) {}
  translate(line: number, character: number): Position {
    return new Position(this.line + line, this.character + character);
  }
}
class Range {
  constructor(readonly start: Position, readonly end: Position) {}
}
class TextValue {
  constructor(readonly value: string) {}
}
const moduleLoader = require("node:module");
const originalLoad = moduleLoader._load;
let Provider: typeof import("../src/completion").DroidCompletionProvider;
try {
  moduleLoader._load = function (id: string, ...args: unknown[]) {
    if (id === "vscode") {
      return {
        Position, Range,
        SnippetString: TextValue,
        MarkdownString: TextValue,
        CompletionItem: class {
          constructor(readonly label: string) {}
        },
        CompletionItemKind: {},
      };
    }
    return originalLoad.call(this, id, ...args);
  };
  Provider = require("../src/completion").DroidCompletionProvider;
} finally {
  moduleLoader._load = originalLoad;
}

const data = DroidData.load([process.cwd(), __dirname]);
const blueprints = new Map([["custom", parseBlueprint("[input]\n    gate", "custom")]]);
const registry = { all: () => blueprints } as BlueprintRegistry;
const provider = new Provider(data, registry);

function suggestions(line: string, cursor: number, languageId = "droid") {
  const doc = {
    languageId,
    lineAt: () => ({ text: line }),
  } as unknown as vscode.TextDocument;
  return provider.provideCompletionItems(doc, new Position(0, cursor) as vscode.Position)!;
}

function rangeOf(item: vscode.CompletionItem): vscode.Range {
  assert.ok(item.range && "start" in item.range, `missing range for ${item.label}`);
  return item.range;
}

function apply(line: string, item: vscode.CompletionItem): string {
  const range = rangeOf(item);
  const snippet = (item.insertText as vscode.SnippetString).value.replace(/\$0/g, "");
  return line.slice(0, range.start.character) + snippet + line.slice(range.end.character);
}

test("[co] filters by co and accepting contour replaces the prefix and bracket", () => {
  const items = suggestions("[co]", 3);
  const contour = items.find((it) => it.label === "contour")!;
  const range = rangeOf(contour);
  assert.equal("[co]".slice(range.start.character, 3), "co");
  const prefixMatches = items.filter((it) =>
    (it.label as string).startsWith("[co]".slice(rangeOf(it).start.character, 3))
  );
  assert.deepEqual(prefixMatches.map((it) => it.label), ["compare", "contour", "copy"]);
  assert.equal(apply("[co]", contour), "[contour]\n    ");
});

test("every circuit and controller replaces every prefix in all three languages", () => {
  const names = [...data.circuits.keys(), ...data.controllers.keys()];
  for (const language of ["droid", "droider", "droid-blueprint"]) {
    for (const name of names) {
      for (let length = 0; length <= name.length; length++) {
        for (const indent of ["", "    "]) {
          for (const closing of ["", "]", "  ]"]) {
            const prefix = name.slice(0, length);
            const before = `${indent}[${prefix}`;
            const line = before + closing;
            const item = suggestions(line, before.length, language).find((it) => it.label === name)!;
            assert.ok(item, `${language}: missing ${name} for ${line}`);
            const range = rangeOf(item);
            assert.equal(line.slice(range.start.character, before.length), prefix);
            assert.equal(range.end.character, line.length);
            const body = data.controllers.has(name) ? "" : "    ";
            assert.equal(apply(line, item), `${indent}[${name}]\n${body}`);
          }
        }
      }
    }
  }
});

test("megacircuits and blueprint port sections share the corrected header range", () => {
  for (const [language, name] of [
    ["droider", "custom"],
    ["droid-blueprint", "custom"],
    ["droid-blueprint", "input"],
    ["droid-blueprint", "output"],
  ]) {
    const prefix = name.slice(0, 2);
    const line = `[${prefix}]`;
    const item = suggestions(line, 3, language).find((it) => it.label === name)!;
    assert.ok(item);
    assert.equal(line.slice(rangeOf(item).start.character, 3), prefix);
    assert.ok(apply(line, item).startsWith(`[${name}]\n`));
  }
  assert.ok(!suggestions("[cu]", 3).some((it) => it.label === "custom"));
});
