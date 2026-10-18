/** Splits comments without treating a # inside quoted text as a comment. */
export function splitComment(raw: string): [string, string] {
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') quoted = !quoted;
    if (raw[i] === "#" && !quoted) return [raw.slice(0, i), raw.slice(i)];
  }
  return [raw, ""];
}

/** Number of characters the master parses, after removing formatting. */
export function firmwareLineLength(code: string): number {
  let quoted = false;
  let length = 0;
  for (const char of code) {
    if (char === '"') quoted = !quoted;
    if (quoted || !/\s/.test(char)) length++;
  }
  return length;
}
