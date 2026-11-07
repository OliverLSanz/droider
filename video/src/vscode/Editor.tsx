// A recreation of VS Code (Dark Modern) with the extension installed, at its own
// CSS pixel size; scenes scale it up. Colours are Dark Modern's.
import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";
import { theme } from "../theme";
import type { Token } from "../highlight";
import { fuzzy } from "../fuzzy";
import * as I from "./Icons";

export const vs = {
  editor: "#1F1F1F",
  chrome: "#181818",
  border: "#2B2B2B",
  fg: "#CCCCCC",
  dim: "#9D9D9D",
  lineNumber: "#6E7681",
  activeLineNumber: "#CCCCCC",
  lineHighlight: "#282828",
  indentGuide: "#404040",
  accent: "#0078D4",
  widget: "#202020",
  widgetBorder: "#454545",
  selection: "#04395E",
  match: "#2AAAFF",
  error: "#F14C4C",
  errorText: "#F88070",
};

export const M = {
  font: 14,
  line: 20,
  /** JetBrains Mono advances 0.6 em. */
  char: 8.4,
  /** Left edge of the text inside a code view. */
  gutter: 64,
  tabs: 35,
  status: 22,
  activity: 48,
  sidebar: 220,
};

const ui = (size = 13, weight = 400): CSSProperties => ({ font: `${weight} ${size}px ${theme.ui}` });
const mono: CSSProperties = { fontFamily: theme.mono, fontSize: M.font, lineHeight: `${M.line}px`, whiteSpace: "pre" };

// ── Window ──

export interface StatusProps {
  errors?: number;
  warnings?: number;
  position?: string;
  language?: string;
  /** The extension's status bar item. */
  card?: "write" | "card" | "build" | null;
  /** 0–1: glow on the card item. */
  cardGlow?: number;
  cardPressed?: number;
}

export function Window({
  width,
  height,
  sidebar,
  status,
  panel,
  children,
  style,
}: {
  width: number;
  height: number;
  sidebar?: ReactNode | false;
  status: StatusProps;
  panel?: { height: number; content: ReactNode } | null;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        background: vs.chrome,
        borderRadius: 10,
        overflow: "hidden",
        border: `1px solid #3c3c3c`,
        boxShadow: "0 40px 120px -30px #000, 0 0 0 1px #00000080",
        color: vs.fg,
        ...style,
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: M.status, width: M.activity, borderRight: `1px solid ${vs.border}` }}>
        <ActivityBar />
      </div>
      {sidebar ? (
        <div style={{ position: "absolute", left: M.activity, top: 0, bottom: M.status, width: M.sidebar, borderRight: `1px solid ${vs.border}` }}>
          {sidebar}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          left: M.activity + (sidebar ? M.sidebar : 0),
          right: 0,
          top: 0,
          bottom: M.status + (panel?.height ?? 0),
          display: "flex",
        }}
      >
        {children}
      </div>
      {panel ? (
        <div
          style={{
            position: "absolute",
            left: M.activity + (sidebar ? M.sidebar : 0),
            right: 0,
            bottom: M.status,
            height: panel.height,
            background: vs.chrome,
            borderTop: `1px solid ${vs.border}`,
            overflow: "hidden",
          }}
        >
          {panel.content}
        </div>
      ) : null}
      <StatusBar {...status} />
    </div>
  );
}

/** Width of the editor area of a window. */
export const editorWidth = (width: number, sidebar: boolean) => width - M.activity - (sidebar ? M.sidebar : 0);

function ActivityBar() {
  const icon = (node: ReactNode, active = false) => (
    <div style={{ height: 48, display: "grid", placeItems: "center", color: active ? "#D7D7D7" : "#868686", position: "relative" }}>
      {active ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: vs.accent }} /> : null}
      {node}
    </div>
  );
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {icon(<I.Menu size={18} />)}
      {icon(<I.Files size={24} />, true)}
      {icon(<I.Search size={24} />)}
      {icon(<I.Branch size={24} />)}
      {icon(<I.Run size={24} />)}
      {icon(<I.Extensions size={24} />)}
      <div style={{ flex: 1 }} />
      {icon(<I.Account size={24} />)}
      {icon(<I.Gear size={24} />)}
    </div>
  );
}

export function Explorer({ active }: { active: string }) {
  const row = (depth: number, label: string, opts: { folder?: boolean; open?: boolean } = {}) => (
    <div
      key={label}
      style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        gap: 5,
        paddingLeft: 8 + depth * 12,
        margin: "0 4px",
        borderRadius: 3,
        background: label === active ? "#37373D" : undefined,
        ...ui(13),
        color: vs.fg,
      }}
    >
      {opts.folder ? opts.open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} /> : <I.FileLines size={14} color="#9D9D9D" style={{ marginLeft: 2 }} />}
      {label}
    </div>
  );
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", ...ui(13) }}>
      <div style={{ height: 35, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 0 20px", ...ui(13, 600) }}>
        Explorer <I.Ellipsis size={16} />
      </div>
      {row(0, "demo", { folder: true, open: true })}
      {row(1, "blueprints", { folder: true, open: active === "pluck.blueprint" })}
      {active === "pluck.blueprint" ? row(2, "pluck.blueprint") : null}
      {active === "duet.ini" ? row(1, "dist", { folder: true, open: true }) : null}
      {active === "duet.ini" ? row(2, "duet.ini") : null}
      {row(1, "duet.droider")}
      {row(1, "melody.ini")}
      <div style={{ flex: 1 }} />
      {["Outline", "Timeline"].map((t) => (
        <div key={t} style={{ height: 26, borderTop: `1px solid ${vs.border}`, display: "flex", alignItems: "center", gap: 4, paddingLeft: 6, ...ui(12, 600) }}>
          <I.ChevronRight size={14} /> {t}
        </div>
      ))}
    </div>
  );
}

function StatusBar({ errors = 0, warnings = 0, position = "Ln 1, Col 1", language = "DROID Patch", card = "write", cardGlow = 0, cardPressed = 0 }: StatusProps) {
  const item: CSSProperties = { display: "flex", alignItems: "center", gap: 4, padding: "0 7px", height: "100%", whiteSpace: "nowrap", flexShrink: 0 };
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: M.status,
        background: vs.chrome,
        borderTop: `1px solid ${vs.border}`,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
        ...ui(12),
        color: vs.fg,
      }}
    >
      <div style={{ ...item, padding: "0 10px" }}>
        <I.Remote size={14} />
      </div>
      <div style={{ ...item }}>
        <I.ErrorIcon size={14} color={vs.fg} /> {errors} <I.Warning size={14} /> {warnings}
      </div>
      <div style={{ flex: 1, minWidth: 0 }} />
      <div style={item}>{position}</div>
      <div style={item}>Spaces: 4</div>
      <div style={item}>UTF-8</div>
      <div style={item}>LF</div>
      <div style={item}>{language}</div>
      {card ? (
        <div
          style={{
            ...item,
            position: "relative",
            borderRadius: 4,
            background: cardGlow > 0 ? `rgba(56,189,248,${0.18 * cardGlow + 0.2 * cardPressed})` : undefined,
            boxShadow: cardGlow > 0 ? `0 0 0 ${1.5 * cardGlow}px rgba(56,189,248,${0.9 * cardGlow}), 0 0 ${18 * cardGlow}px rgba(56,189,248,${0.7 * cardGlow})` : undefined,
            transform: `scale(${1 - 0.06 * cardPressed})`,
          }}
        >
          {card === "write" ? <I.CloudUpload size={15} /> : card === "build" ? <I.Package size={15} /> : <I.Disconnect size={15} />}
          {card === "write" ? "Write to DROID" : card === "build" ? "Build to dist" : "DROID Card"}
        </div>
      ) : null}
      <div style={{ ...item, padding: "0 10px" }}>
        <I.Bell size={14} />
      </div>
    </div>
  );
}

// ── Editor group: tabs + content ──

export interface Tab {
  name: string;
  active?: boolean;
  errors?: number;
}

export function Group({
  width,
  tabs,
  actions = [],
  children,
  style,
}: {
  width: number | string;
  tabs: Tab[];
  actions?: ("graph" | "hardware" | "build" | "split" | "more")[];
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ width, height: "100%", display: "flex", flexDirection: "column", borderLeft: `1px solid ${vs.border}`, ...style }}>
      <div style={{ height: M.tabs, background: vs.chrome, display: "flex", alignItems: "stretch", borderBottom: `1px solid ${vs.border}`, flexShrink: 0 }}>
        {tabs.map((t) => (
          <div
            key={t.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              background: t.active ? vs.editor : vs.chrome,
              borderRight: `1px solid ${vs.border}`,
              borderTop: `1px solid ${t.active ? vs.accent : "transparent"}`,
              marginBottom: t.active ? -1 : 0,
              ...ui(13),
              color: t.errors ? vs.errorText : t.active ? "#FFFFFF" : vs.dim,
              whiteSpace: "nowrap",
            }}
          >
            <I.FileLines size={14} color={t.active ? "#C5C5C5" : vs.dim} />
            {t.name}
            {t.errors ? <span style={{ ...ui(12), color: vs.errorText }}>{t.errors}</span> : null}
            <I.Close size={14} color={t.active ? "#C5C5C5" : "transparent"} />
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", color: "#C5C5C5" }}>
          {actions.map((a) =>
            a === "graph" ? (
              <I.Hierarchy key={a} size={16} />
            ) : a === "hardware" ? (
              <I.Board key={a} size={16} />
            ) : a === "build" ? (
              <I.Package key={a} size={16} />
            ) : a === "split" ? (
              <I.Split key={a} size={16} />
            ) : (
              <I.Ellipsis key={a} size={16} />
            ),
          )}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", background: vs.editor, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

// ── Code view ──

export interface Squiggle {
  line: number;
  from: number;
  to: number;
}

export interface Mark {
  line: number;
  from: number;
  to: number;
  color: string;
  /** 0–1 */
  opacity: number;
}

export type At = (line: number, col: number) => { x: number; y: number };

const SQUIGGLE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='6' height='3'><path d='M0 2.5 L1.5 1 L3 2.5 L4.5 1 L6 2.5' fill='none' stroke='${vs.error}' stroke-width='0.9'/></svg>`,
)}")`;

/**
 * The text of an editor: line numbers, indent guides, coloured tokens, caret,
 * squiggles and marks. `scroll` is the first visible line (fractional).
 */
export function Code({
  lines,
  scroll = 0,
  caret,
  caretVisible = true,
  squiggles = [],
  marks = [],
  dim,
  overlay,
  rows = 60,
}: {
  lines: Token[][];
  scroll?: number;
  caret?: { line: number; col: number } | null;
  caretVisible?: boolean;
  squiggles?: Squiggle[];
  marks?: Mark[];
  /** Lines outside this range are dimmed (0–1 amount). */
  dim?: { from: number; to: number; amount: number };
  overlay?: (at: At) => ReactNode;
  rows?: number;
}) {
  const at: At = (line, col) => ({ x: M.gutter + col * M.char, y: (line - scroll) * M.line + 4 });
  const first = Math.max(0, Math.floor(scroll));
  const visible = lines.slice(first, first + rows);
  const indentOf = (i: number): number => {
    const toks = lines[i];
    if (!toks) return 0;
    const text = toks.map((t) => t.text).join("");
    if (!text.trim()) {
      // Blank lines inside a block keep the guide of the block.
      const prev = i > 0 ? indentOf2(i - 1, -1) : 0;
      const next = indentOf2(i + 1, 1);
      return Math.min(prev, next);
    }
    return text.match(/^ */)![0].length;
  };
  const indentOf2 = (i: number, dir: number): number => {
    for (let k = i; k >= 0 && k < lines.length; k += dir) {
      const text = lines[k].map((t) => t.text).join("");
      if (text.trim()) return text.match(/^ */)![0].length;
    }
    return 0;
  };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {caret ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: at(caret.line, 0).y,
            height: M.line,
            border: `2px solid ${vs.lineHighlight}`,
            boxSizing: "border-box",
          }}
        />
      ) : null}
      {marks.map((m, k) => {
        const a = at(m.line, m.from);
        return (
          <div
            key={`m${k}`}
            style={{
              position: "absolute",
              left: a.x - 3,
              top: a.y - 1,
              width: (m.to - m.from) * M.char + 6,
              height: M.line + 2,
              borderRadius: 4,
              background: m.color,
              opacity: m.opacity,
            }}
          />
        );
      })}
      {visible.map((tokens, k) => {
        const i = first + k;
        const y = at(i, 0).y;
        const d = dim && (i < dim.from || i > dim.to) ? dim.amount : 0;
        const guides = Math.floor(indentOf(i) / 4);
        return (
          <Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: 0,
                width: 44,
                top: y,
                textAlign: "right",
                ...mono,
                color: caret?.line === i ? vs.activeLineNumber : vs.lineNumber,
                opacity: 1 - d * 0.7,
              }}
            >
              {i + 1}
            </div>
            {Array.from({ length: guides }, (_, g) => (
              <div key={g} style={{ position: "absolute", left: M.gutter + g * 4 * M.char, top: y, width: 1, height: M.line, background: vs.indentGuide, opacity: 1 - d * 0.7 }} />
            ))}
            <div style={{ position: "absolute", left: M.gutter, top: y, ...mono, opacity: 1 - d * 0.75 }}>
              {tokens.map((t, j) => (
                <span key={j} style={{ color: t.color }}>
                  {t.text}
                </span>
              ))}
            </div>
          </Fragment>
        );
      })}
      {squiggles.map((s, k) => {
        const a = at(s.line, s.from);
        return (
          <div
            key={`s${k}`}
            style={{
              position: "absolute",
              left: a.x,
              top: a.y + M.line - 4,
              width: Math.max(1, s.to - s.from) * M.char,
              height: 3,
              backgroundImage: SQUIGGLE,
              backgroundRepeat: "repeat-x",
            }}
          />
        );
      })}
      {caret && caretVisible ? (
        <div style={{ position: "absolute", left: at(caret.line, caret.col).x - 1, top: at(caret.line, 0).y + 1, width: 2, height: M.line - 2, background: "#AEAFAD" }} />
      ) : null}
      {overlay?.(at)}
    </div>
  );
}

// ── Suggest widget ──

export interface Item {
  label: string;
  kind: I.Kind;
  detail: string;
}

export function Suggest({ items, filter, selected, x, y, width = 430, rows = 8, appear = 1, maxRight = Infinity }: { items: Item[]; filter: string; selected: number; x: number; y: number; width?: number; rows?: number; appear?: number; maxRight?: number }) {
  const list = fuzzy(items, filter.replace(/^_/, "_"));
  const shown = list.slice(0, rows);
  const typed = filter.toLowerCase();
  return (
    <div
      style={{
        position: "absolute",
        // Like VS Code, shift left rather than run off the editor.
        left: Math.min(x - 26, maxRight - width - 6),
        top: y,
        width,
        background: vs.widget,
        border: `1px solid ${vs.widgetBorder}`,
        borderRadius: 4,
        boxShadow: "0 6px 18px #000000aa",
        overflow: "hidden",
        opacity: appear,
        transform: `translateY(${(1 - appear) * -4}px)`,
        zIndex: 5,
      }}
    >
      {shown.map((item, i) => {
        // Highlight the typed characters in the label, like VS Code.
        const hl = new Set<number>();
        let pos = -1;
        for (const ch of typed) {
          pos = item.label.toLowerCase().indexOf(ch, pos + 1);
          if (pos >= 0) hl.add(pos);
        }
        const focused = i === selected;
        return (
          <div
            key={item.label}
            style={{
              height: 22,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 6px",
              background: focused ? vs.selection : undefined,
              outline: focused ? `1px solid ${vs.accent}` : undefined,
              outlineOffset: -1,
              ...mono,
              lineHeight: "22px",
            }}
          >
            <I.KindIcon kind={item.kind} size={15} />
            <span>
              {Array.from(item.label, (ch, k) => (
                <span key={k} style={{ color: hl.has(k) ? vs.match : focused ? "#FFFFFF" : vs.fg, fontWeight: hl.has(k) ? 700 : 400 }}>
                  {ch}
                </span>
              ))}
            </span>
            <span style={{ flex: 1 }} />
            {focused ? <span style={{ ...mono, fontSize: 12.5, color: vs.fg, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis" }}>{item.detail}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Hover card (markdown) ──

/** Renders the subset of markdown the extension's hovers use: **bold**, _italic_, `code`, paragraphs. */
export function Markdown({ md, maxParagraphs = 99 }: { md: string; maxParagraphs?: number }) {
  const paragraphs = md
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " "))
    .slice(0, maxParagraphs);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} style={{ margin: i === 0 ? "0 0 8px" : "8px 0", lineHeight: 1.45 }}>
          {inline(p)}
        </p>
      ))}
    </>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|(?<![A-Za-z0-9])_(.+?)_(?![A-Za-z0-9])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b key={k++}>{m[1]}</b>);
    else if (m[2] !== undefined)
      out.push(
        <code key={k++} style={{ fontFamily: theme.mono, fontSize: 12.5, background: "#ffffff17", borderRadius: 3, padding: "1px 4px" }}>
          {m[2]}
        </code>,
      );
    else out.push(<i key={k++}>{m[3]}</i>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function HoverCard({ x, y, width = 520, appear = 1, children, above = true, maxRight = Infinity }: { x: number; y: number; width?: number; appear?: number; children: ReactNode; above?: boolean; maxRight?: number }) {
  const w = Math.min(width, maxRight - 12);
  return (
    <div
      style={{
        position: "absolute",
        left: Math.max(4, Math.min(x, maxRight - w - 6)),
        ...(above ? { bottom: `calc(100% - ${y}px)` } : { top: y }),
        width: w,
        background: vs.widget,
        border: `1px solid ${vs.widgetBorder}`,
        borderRadius: 4,
        boxShadow: "0 6px 18px #000000aa",
        padding: "7px 10px",
        ...ui(13),
        color: vs.fg,
        opacity: appear,
        zIndex: 6,
      }}
    >
      {children}
    </div>
  );
}

// ── Problems panel ──

export interface Problem {
  line: number;
  startCol: number;
  message: string;
}

export function ProblemsPanel({ file, problems, highlight = 0 }: { file: string; problems: Problem[]; highlight?: number }) {
  return (
    <div style={{ height: "100%", ...ui(13) }}>
      <div style={{ height: 35, display: "flex", alignItems: "center", gap: 20, padding: "0 10px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, color: "#E7E7E7", borderBottom: `1px solid ${vs.accent}`, padding: "7px 2px" }}>
          Problems
          {problems.length ? (
            <span style={{ background: vs.accent, color: "#fff", borderRadius: 9, padding: "0 6px", fontSize: 11, lineHeight: "16px" }}>{problems.length}</span>
          ) : null}
        </span>
        {["Output", "Debug Console", "Terminal"].map((t) => (
          <span key={t} style={{ color: vs.dim }}>
            {t}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <I.Filter size={14} color={vs.dim} />
        <I.Close size={14} color={vs.dim} />
      </div>
      {problems.length ? (
        <div style={{ padding: "2px 0" }}>
          <div style={{ height: 22, display: "flex", alignItems: "center", gap: 5, paddingLeft: 12 }}>
            <I.ChevronDown size={14} />
            <I.FileLines size={14} color={vs.dim} />
            {file}
            <span style={{ background: "#616161", color: "#fff", borderRadius: 9, padding: "0 6px", fontSize: 11, lineHeight: "16px" }}>{problems.length}</span>
          </div>
          {problems.map((p, i) => (
            <div
              key={i}
              style={{
                height: 22,
                display: "flex",
                alignItems: "center",
                gap: 6,
                paddingLeft: 40,
                background: i === 0 && highlight > 0 ? `rgba(4,57,94,${highlight})` : undefined,
              }}
            >
              <I.ErrorIcon size={15} />
              <span style={{ color: vs.fg }}>{p.message}</span>
              <span style={{ color: vs.dim }}>droid</span>
              <span style={{ color: vs.dim }}>
                [Ln {p.line + 1}, Col {p.startCol + 1}]
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: "6px 22px", color: vs.fg }}>No problems have been detected in the workspace.</div>
      )}
    </div>
  );
}

// ── Notification toast (bottom right) ──

export function Toast({ children, appear = 1, progress, right = 10, bottom = 10, width = 440 }: { children: ReactNode; appear?: number; progress?: number | null; right?: number; bottom?: number; width?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        right,
        bottom,
        width,
        background: vs.widget,
        border: `1px solid ${vs.widgetBorder}`,
        borderRadius: 6,
        boxShadow: "0 8px 24px #000000b0",
        ...ui(13),
        color: vs.fg,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 16}px)`,
        overflow: "hidden",
        zIndex: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "11px 12px", lineHeight: 1.4 }}>{children}</div>
      {progress !== undefined && progress !== null ? (
        <div style={{ height: 2, background: "transparent", position: "relative" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: vs.accent }} />
        </div>
      ) : null}
    </div>
  );
}
