// YouTube thumbnail (1280×720): the promise in big type on the left, the editor
// with rainbow cables and a caught typo on the right, the circuit graph behind it.
import { AbsoluteFill, Img, staticFile } from "remotion";
import { docs, patch, tokens } from "./data";
import { Logo } from "./Logo";
import { gradientText, theme } from "./theme";
import { Code, Group, HoverCard, Window, vs } from "./vscode/Editor";

const TYPO = patch.typoLine;
const doc = docs.melodyO9;
const err = patch.lint.melodyO9[0];

export function Thumbnail() {
  return (
    <AbsoluteFill style={{ background: theme.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 10% 15%, #38BDF833, transparent 42%), radial-gradient(circle at 80% 85%, #F472B62a, transparent 45%), radial-gradient(circle at 95% 5%, #A78BFA26, transparent 35%)",
        }}
      />
      {/* The circuit graph, far behind. */}
      <Img
        src={staticFile("view-melody-graph.webp")}
        style={{ position: "absolute", left: 520, top: -40, width: 1100, opacity: 0.38, transform: "rotate(-4deg)", filter: "saturate(1.3)" }}
      />
      {/* The editor, tilted. */}
      <div
        style={{
          position: "absolute",
          left: 610,
          top: 120,
          transform: "perspective(1600px) rotateY(-14deg) rotateX(5deg) rotateZ(-2deg) scale(1.5)",
          transformOrigin: "left top",
          filter: "drop-shadow(0 40px 60px #000d)",
        }}
      >
        <Window width={560} height={330} status={{ errors: 1 }}>
          <Group width="100%" tabs={[{ name: "melody.ini", active: true, errors: 1 }]} actions={["graph", "hardware", "more"]}>
            <Code
              lines={tokens(doc)}
              scroll={TYPO - 10}
              caret={{ line: TYPO, col: 16 }}
              squiggles={[{ line: err.line, from: err.startCol, to: err.endCol }]}
              marks={[{ line: err.line, from: err.startCol, to: err.endCol, color: vs.error, opacity: 0.3 }]}
              overlay={(at) => {
                const p = at(TYPO, err.startCol);
                return (
                  <HoverCard x={p.x - 20} y={p.y - 2} width={230}>
                    <span style={{ color: vs.fg }}>{err.message}</span> <span style={{ color: vs.dim }}>droid</span>
                  </HoverCard>
                );
              }}
            />
          </Group>
        </Window>
      </div>
      {/* Fade the editor under the text. */}
      <AbsoluteFill style={{ background: `linear-gradient(90deg, ${theme.bg} 40%, ${theme.bg}cc 48%, ${theme.bg}00 58%)` }} />
      <div style={{ position: "absolute", left: 64, top: 70, width: 640 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Logo size={92} />
          <div style={{ font: `700 50px ${theme.sans}`, letterSpacing: "-0.04em", color: theme.text }}>Droider</div>
        </div>
        <div style={{ font: `700 104px/0.98 ${theme.sans}`, letterSpacing: "-0.05em", color: theme.text, marginTop: 40 }}>
          DROID patches
          <br />
          <span style={gradientText}>in VS Code</span>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            marginTop: 40,
            padding: "14px 26px",
            borderRadius: 999,
            background: theme.text,
            color: theme.bg,
            font: `700 30px ${theme.sans}`,
          }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 6, background: theme.green }} />
          Free extension
        </div>
      </div>
    </AbsoluteFill>
  );
}
