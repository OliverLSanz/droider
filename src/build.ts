// Shared, VSCode-free validation for builds and card uploads.
import { Blueprint, expandToIni } from "./blueprints";
import { DroidData } from "./data";
import { lint, Problem } from "./linter";

export interface BuildProblem extends Problem {
  location: "source" | "generated";
}

export function buildPatch(
  text: string,
  data: DroidData,
  mode: "ini" | "droider",
  blueprints: Map<string, Blueprint> = new Map()
): { ini: string; problems: BuildProblem[] } {
  const sourceProblems: BuildProblem[] = lint(text, data, { mode, blueprints })
    .map((p) => ({ ...p, location: "source" }));
  if (mode === "ini") return { ini: text, problems: sourceProblems };

  const expanded = expandToIni(text, blueprints);
  const problems: BuildProblem[] = [
    ...sourceProblems,
    ...expanded.problems.map((p): BuildProblem => ({ ...p, location: "source" })),
    ...lint(expanded.ini, data, { mode: "ini" })
      .filter((p) => p.severity === "error")
      .map((p): BuildProblem => ({ ...p, location: "generated" })),
  ];
  return { ini: expanded.ini, problems };
}

export function describeBuildProblem(problem: BuildProblem): string {
  const location = problem.location === "generated" ? "generated .ini" : "source";
  return `${problem.message} (${location} line ${problem.line + 1})`;
}
