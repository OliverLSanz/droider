#!/usr/bin/env node
// Linter CLI, so an agent (or a human, or CI) can validate a patch from the
// terminal using EXACTLY the same logic as the VSCode extension: it imports the
// same `lint` from ./linter and the same data from ./data. There is no
// duplicated logic.
//
//   node out/cli.js <patch.ini> [...]      human-readable output
//   node out/cli.js --json <patch.ini>     JSON output (for agents/tools)
//
// Exit code: 0 if no errors, 1 if there is any error, 2 on misuse.

import * as fs from "fs";
import { DroidData } from "./data";
import { lint, Problem } from "./linter";

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
    const problems = lint(text, data);
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
