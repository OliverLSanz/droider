// Live errors: the typo of the opening, flagged the moment it is typed, with the
// linter's own message, then fixed.
import { Easing } from "remotion";
import { docs, patch, tokens } from "../data";
import { ERROR_OFF, SCENES } from "../score";
import { errorStates } from "../stories";
import { theme } from "../theme";
import { ramp } from "../timing";
import { Caption, G, Path } from "../ui";
import { Code, Group, HoverCard, M, Problem, ProblemsPanel, Window, vs } from "../vscode/Editor";
import { Shell, useFrame } from "./Shell";

const TYPO = patch.typoLine;
const base = docs.melody.split("\n");

export function Errors({ step }: { step: number }) {
  const f = useFrame();
  const local = step - SCENES.errors.from;
  const index = Math.max(0, errorStates.findLastIndex((s) => s.at <= local));
  const value = errorStates[index].value;
  const doc = base.map((l, i) => (i === TYPO ? l.replace("O3", value) : l)).join("\n");
  const problems = patch.lintStates.errors[index] as (Problem & { endCol: number })[];
  const col = base[TYPO].indexOf("O3") + value.length;

  const panel = 112 * ramp(local, 10, 12, Easing.out(Easing.cubic));
  const fixed = step >= ERROR_OFF;
  const hover = ramp(local, 15.5, 16.3) * (1 - ramp(local, 27, 27.8));
  const flash = problems.length && !fixed ? Math.max(0, 1 - (local - 9) / 4) : 0;

  return (
    <>
      <Caption
        eyebrow="LIVE ERRORS"
        step={local}
        color={fixed ? theme.green : theme.red}
        lines={[
          { at: 0, text: "Make the same typo again…" },
          { at: 10, text: "Caught as you type, not on the module." },
          { at: 32, text: <><G>No problems.</G> Off to the card.</> },
        ]}
      />
      <Shell>
        <Window
          width={f.w}
          height={f.h}
          status={{ errors: problems.length, position: `Ln ${TYPO + 1}, Col ${col + 1}` }}
          panel={panel > 1 ? { height: panel, content: <ProblemsPanel file="melody.ini" problems={problems} highlight={hover} /> } : null}
        >
          <Group width="100%" tabs={[{ name: "melody.ini", active: true, errors: problems.length }]} actions={["graph", "hardware", "split", "more"]}>
            <Code
              lines={tokens(doc)}
              scroll={TYPO - 7}
              caret={{ line: TYPO, col }}
              squiggles={problems.map((p) => ({ line: p.line, from: p.startCol, to: p.endCol }))}
              marks={problems.map((p) => ({ line: p.line, from: p.startCol, to: p.endCol, color: vs.error, opacity: flash * 0.35 }))}
              overlay={(at) => {
                const o = at(TYPO, base[TYPO].indexOf("O3") + 1);
                const err = patch.lintStates.errors[2][0];
                return (
                  <>
                    {hover > 0 ? (
                      <HoverCard x={o.x - 30} y={o.y - 2} width={400} appear={hover} maxRight={f.w - M.activity}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
                          <span style={{ color: vs.fg }}>{err.message}</span>
                          <span style={{ color: vs.dim }}>droid</span>
                        </div>
                        <div style={{ borderTop: `1px solid ${vs.widgetBorder}`, margin: "0 -10px -7px", padding: "5px 10px", display: "flex", gap: 14, fontSize: 12.5 }}>
                          <span style={{ color: "#4daafc" }}>View Problem (⌥F8)</span>
                          <span style={{ color: vs.dim }}>No quick fixes available</span>
                        </div>
                      </HoverCard>
                    ) : null}
                    <Path
                      step={local}
                      stops={[
                        { at: 12, x: o.x + 160, y: o.y + 70 },
                        { at: 15, x: o.x, y: o.y + 12 },
                        { at: 27.5, x: o.x, y: o.y + 12 },
                        { at: 30, x: o.x + 140, y: o.y + 90 },
                      ]}
                      fadeOut={1}
                    />
                  </>
                );
              }}
            />
          </Group>
        </Window>
      </Shell>
    </>
  );
}
