// The generated data (scripts/gen-data.ts) with the helpers the scenes use.
import patch from "./generated/patch.json";
import { highlight, type Mode, type Schema } from "./highlight";
import type { Item } from "./vscode/Editor";

export { patch };

export const schema: Schema = {
  roles: patch.roles as Schema["roles"],
  controllers: patch.controllers,
  blueprints: { [patch.blueprint.name]: { inputs: patch.blueprint.inputs, outputs: patch.blueprint.outputs } },
};

export const docs = patch.docs;
export const tokens = (text: string, mode: Mode = "ini") => highlight(text, schema, mode);

export const lists: Record<string, Item[]> = patch.completions as Record<string, Item[]>;

export interface Problem {
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  severity: string;
}

/** 0-based line of `text` in a document. */
export const lineOf = (doc: string, match: (line: string) => boolean, from = 0) => {
  const lines = doc.split("\n");
  for (let i = from; i < lines.length; i++) if (match(lines[i])) return i;
  throw new Error("line not found");
};
