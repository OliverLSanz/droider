#!/usr/bin/env node
// Linter CLI, so an agent (or a human, or CI) can validate a patch from the
// terminal using EXACTLY the same logic as the VSCode extension: it imports the
// same `lint` from ./linter and the same data from ./data. There is no
// duplicated logic.
//
//   node out/cli.js <patch.ini> [...]      human-readable output
//   node out/cli.js --json <patch.ini>     JSON output (for agents/tools)
//
// The mode is inferred from each file's extension (.ini / .droider / .blueprint),
// and megacircuit definitions are loaded from every *.blueprint under the cwd.
//
// Exit code: 0 if no errors, 1 if there is any error, 2 on misuse.

import * as fs from "fs";
import * as path from "path";
import { DroidData } from "./data";
import { lint, modeForFile, Problem } from "./linter";
import { Blueprint, parseBlueprint } from "./blueprints";

interface FileResult {
  file: string;
  problems: {
    line: number; // 1-based
    column: number; // 1-based
    endColumn: number; // 1-based
    severity: "error" | "warning";
    message: string;
  }[];
}

function toResult(file: string, problems: Problem[]): FileResult {
  return {
    file,
    problems: problems.map((p) => ({
      line: p.line + 1,
      column: p.startCol + 1,
      endColumn: p.endCol + 1,
      severity: p.severity,
      message: p.message,
    })),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const files = args.filter((a) => !a.startsWith("--"));

  if (files.length === 0) {
    console.error("usage: node out/cli.js [--json] <patch.ini> [...]");
    process.exit(2);
  }

  // Locate the YAML files by walking up from the cwd or from the CLI's own path.
  const data = DroidData.load([process.cwd(), __dirname]);
  const blueprints = loadBlueprints(process.cwd());

  const results: FileResult[] = [];
  let errorCount = 0;

  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      console.error(`could not read: ${file}`);
      process.exit(2);
    }
    const problems = lint(text, data, { mode: modeForFile(file), blueprints });
    errorCount += problems.filter((p) => p.severity === "error").length;
    results.push(toResult(file, problems));
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printHuman(results);
  }
  process.exit(errorCount > 0 ? 1 : 0);
}

/** Loads every *.blueprint under `root` into a name -> Blueprint map. */
function loadBlueprints(root: string): Map<string, Blueprint> {
  const map = new Map<string, Blueprint>();
  const SKIP = new Set(["node_modules", ".git", "out", "dist"]);
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(full);
      } else if (e.name.endsWith(".blueprint")) {
        const name = path.basename(e.name, ".blueprint");
        try {
          map.set(name, parseBlueprint(fs.readFileSync(full, "utf8"), name));
        } catch {
          // ignore unreadable blueprint
        }
      }
    }
  };
  walk(root);
  return map;
}

function printHuman(results: FileResult[]): void {
  for (const r of results) {
    console.log(r.file);
    if (r.problems.length === 0) {
      console.log("  ✓ no problems");
      continue;
    }
    for (const p of r.problems) {
      console.log(
        `  ${p.line}:${p.column} [${p.severity}] ${p.message}`
      );
    }
    const errs = r.problems.filter((p) => p.severity === "error").length;
    const warns = r.problems.length - errs;
    console.log(`  ${errs} error(s), ${warns} warning(s)`);
  }
}

main();
