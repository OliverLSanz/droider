// Final .droider lowering pass: hardware line limits must not constrain the
// author's cable names or formulas. Ordinary short patches stay unchanged.
import { fitSlotLength } from "./maths";
import { firmwareLineLength, splitComment } from "./patchText";

const TOKEN_RE = /"[^"]*"|_[A-Za-z0-9_]+/g;

export function fitHardwareLines(ini: string): string {
  const lines = ini.split(/\r?\n/);
  const used = new Set<string>();
  const aliases = new Map<string, string>();
  for (const raw of lines) {
    for (const token of splitComment(raw)[0].match(TOKEN_RE) ?? []) {
      if (token.startsWith("_")) used.add(token.toLowerCase());
    }
  }
  let counter = 0;
  const fresh = () => {
    let name: string;
    do { name = `_C${++counter}`; } while (used.has(name.toLowerCase()));
    used.add(name.toLowerCase());
    return name;
  };
  const rewrite = (code: string) => code.replace(TOKEN_RE, (token) => aliases.get(token) ?? token);

  // Only shorten names which actually cause an oversized line, and replace
  // every occurrence consistently. Never rewrite comments or text literals.
  for (const raw of lines) {
    const [code] = splitComment(raw);
    if (firmwareLineLength(rewrite(code)) <= 63) continue;
    const cables = [...new Set(code.match(TOKEN_RE) ?? [])]
      .filter((token) => token.startsWith("_"))
      .sort((a, b) => b.length - a.length);
    for (const cable of cables) {
      if (aliases.has(cable)) continue;
      const alias = fresh();
      if (alias.length < cable.length) aliases.set(cable, alias);
      if (firmwareLineLength(rewrite(code)) <= 63) break;
    }
  }

  const out: string[] = [];
  let block: string[] = [];
  const flush = () => {
    const copies: string[] = [];
    const processed = block.map((raw) => {
      const [original, comment] = splitComment(raw);
      const code = rewrite(original);
      const eq = code.indexOf("=");
      if (eq < 0 || firmwareLineLength(code) <= 63) return code + comment;
      const lhs = code.slice(0, eq + 1);
      const fitted = fitSlotLength(code.slice(eq + 1).trim(), 63 - firmwareLineLength(lhs), fresh);
      for (const copy of fitted.copies) {
        copies.push("[copy]", `    input = ${copy.input}`, `    output = ${copy.output}`);
      }
      return `${lhs} ${fitted.expr}` + (comment ? `  ${comment}` : "");
    });
    out.push(...copies, ...processed);
    block = [];
  };
  for (const raw of lines) {
    if (/^\s*\[[a-z0-9]+\]\s*$/.test(splitComment(raw)[0])) flush();
    block.push(raw);
  }
  flush();
  if (aliases.size) {
    out.push("", "# Compiler cable aliases:", ...[...aliases].map(([name, alias]) => `# ${alias} = ${name}`));
  }
  return out.join("\n");
}
