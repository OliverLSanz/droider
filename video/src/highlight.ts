// The extension's colouring, line by line, as VS Code Dark Modern shows it:
//   - the TextMate grammar colours comments and [headers] (syntaxes/droid.tmLanguage.json),
//   - the semantic layer colours parameter names and values (src/semantic.ts),
//   - the cable decorator gives every internal cable its own colour (src/cables.ts).
// Pure functions: the scenes run them on whatever text is on screen at a frame.

export const colors = {
  fg: "#CCCCCC",
  comment: "#6A9955",
  bracket: "#FFD700",
  header: "#DCDCAA",
  input: "#4FC1FF",
  output: "#C586C0",
  register: "#4EC9B0",
  bool: "#569CD6",
  number: "#B5CEA8",
  string: "#CE9178",
  operator: "#D4D4D4",
  unverified: "#808080",
  paren: "#DA70D6",
};

/** Stable colour of a cable: the same hash → HSL hue as colorForCable in src/cables.ts. */
export function cableColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 70, 62);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const hex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export interface Token {
  text: string;
  color: string;
}

export interface Schema {
  /** Parameter roles of the known circuits. */
  roles: Record<string, Record<string, "input" | "output">>;
  controllers: string[];
  /** Megacircuits usable in .droider files, with their ports. */
  blueprints?: Record<string, { inputs: string[]; outputs: string[] }>;
}

export type Mode = "ini" | "droider" | "blueprint";

const HEADER_RE = /^\[([a-z0-9]+)\]$/;
const VALUE_RE = /"[^"]*"|_[A-Za-z0-9_]+|-?\d+(?:\.\d+)?(?:[V%])?|\b(?:on|off)\b|[A-Za-z][A-Za-z0-9]*(?:\.\d+)?|[*+/-]/g;

/** Splits a document into coloured tokens per line. */
export function highlight(text: string, schema: Schema, mode: Mode = "ini"): Token[][] {
  const lines = text.split("\n");
  let declaring = true;
  let roles: Record<string, "input" | "output"> | null = null;
  let section: "input" | "output" | null = null;
  let unknown = false;

  return lines.map((raw) => {
    // Per-character colours, then merged into runs.
    const color: (string | null)[] = Array.from(raw, () => null);
    const paint = (from: number, to: number, c: string) => {
      for (let i = from; i < to && i < color.length; i++) color[i] = c;
    };
    const hash = raw.indexOf("#");
    const code = hash >= 0 ? raw.slice(0, hash) : raw;
    if (hash >= 0) paint(hash, raw.length, colors.comment);

    // Grammar: [header] at the start of a line.
    const gm = code.match(/^(\s*)(\[)([a-z0-9]+)(\])/);
    if (gm) {
      const at = gm[1].length;
      paint(at, at + 1, colors.bracket);
      paint(at + 1, at + 1 + gm[3].length, colors.header);
      paint(at + 1 + gm[3].length, at + 2 + gm[3].length, colors.bracket);
    }

    const trimmed = code.trim();
    const hm = trimmed.match(HEADER_RE);
    if (hm) {
      const name = hm[1];
      if (!(schema.controllers.includes(name) && declaring)) {
        declaring = false;
        roles = null;
        section = null;
        unknown = false;
        if (mode === "blueprint" && (name === "input" || name === "output")) section = name;
        else if (mode !== "ini" && schema.blueprints?.[name]) {
          const bp = schema.blueprints[name];
          roles = Object.fromEntries([...bp.inputs.map((p) => [p, "input"]), ...bp.outputs.map((p) => [p, "output"])]);
        } else if (schema.roles[name]) roles = schema.roles[name];
        else unknown = true;
      }
    } else if (trimmed) {
      declaring = false;
      const eq = code.indexOf("=");
      if (unknown) {
        const start = code.search(/\S/);
        paint(start, code.replace(/\s+$/, "").length, colors.unverified);
      } else if (section) {
        const m = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)/);
        if (m) {
          const at = code.indexOf(m[1]);
          paint(at, at + m[1].length, section === "input" ? colors.input : colors.output);
          if (eq >= 0) {
            paint(eq, eq + 1, colors.operator);
            value(code, eq + 1, paint);
          }
        }
      } else if (eq >= 0 && roles) {
        const name = code.slice(0, eq).trim();
        const role = roles[name];
        if (role) {
          const at = code.indexOf(name);
          paint(at, at + name.length, role === "input" ? colors.input : colors.output);
        }
        paint(eq, eq + 1, colors.operator);
        value(code, eq + 1, paint);
        // Cables, from the decorator (only on the value side).
        const re = /_[A-Za-z0-9_]+/g;
        let m: RegExpExecArray | null;
        const rhs = code.slice(eq + 1);
        while ((m = re.exec(rhs))) paint(eq + 1 + m.index, eq + 1 + m.index + m[0].length, cableColor(m[0]));
      }
    }

    // Bracket pair colourisation: first-level parentheses in values are gold.
    if (!hm)
      for (let i = 0; i < code.length; i++) if (code[i] === "(" || code[i] === ")") color[i] = colors.bracket;

    const tokens: Token[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = color[i] ?? colors.fg;
      const last = tokens[tokens.length - 1];
      if (last && last.color === c) last.text += raw[i];
      else tokens.push({ text: raw[i], color: c });
    }
    return tokens;
  });
}

function value(code: string, start: number, paint: (from: number, to: number, c: string) => void) {
  const rhs = code.slice(start);
  let m: RegExpExecArray | null;
  VALUE_RE.lastIndex = 0;
  while ((m = VALUE_RE.exec(rhs))) {
    const tok = m[0];
    const at = start + m.index;
    let c: string | null;
    if (tok.startsWith('"')) c = colors.string;
    else if (tok.startsWith("_")) c = null;
    else if (/^-?\d/.test(tok)) c = colors.number;
    else if (tok === "on" || tok === "off") c = colors.bool;
    else if (/^[*+/-]$/.test(tok)) c = colors.operator;
    else c = colors.register;
    if (c) paint(at, at + tok.length, c);
  }
}

/** Plain grey version of the same text (no extension installed). */
export function plain(text: string, color = colors.fg): Token[][] {
  return text.split("\n").map((l) => (l ? [{ text: l, color }] : []));
}
