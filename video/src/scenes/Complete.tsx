// Autocomplete: the [contour] block of melody.ini written with suggestions for
// the circuit, its parameters, the cables in the patch and the registers.
import { Easing } from "remotion";
import { docs, lists, patch, tokens } from "../data";
import { fuzzy } from "../fuzzy";
import { useLayout } from "../layout";
import { SCENES } from "../score";
import { blockStart, caretOf, completeDoc, completeStates, stateAt, type SuggestList } from "../stories";
import { theme } from "../theme";
import { ramp } from "../timing";
import { Caption, G } from "../ui";
import { Code, Group, M, Suggest, Window } from "../vscode/Editor";
import { Shell, useFrame } from "./Shell";

const START = blockStart(docs.melody);
const LABELS: Record<SuggestList, { text: string; color: string }> = {
  header: { text: "circuits", color: "#EE9D28" },
  contour: { text: "parameters", color: "#4FC1FF" },
  contour1: { text: "parameters", color: "#4FC1FF" },
  contour4: { text: "parameters", color: "#4FC1FF" },
  cables: { text: "your cables", color: "#68E25A" },
  registers: { text: "real jacks only", color: "#4EC9B0" },
};

export function Complete({ step }: { step: number }) {
  const f = useFrame();
  const { vertical } = useLayout();
  const local = step - SCENES.complete.from;
  const state = stateAt(completeStates, local);
  const index = completeStates.indexOf(state);
  const { text, line, col } = caretOf(state.block);
  const doc = completeDoc(docs.melody, text);
  const problems = patch.lintStates.complete[index];
  const caretLine = START + line;

  // Keep the block a few lines below the top while it grows.
  const scroll = START - 4 + 3 * ramp(local, 33, 36, Easing.inOut(Easing.cubic));

  const suggest = state.suggest;
  // The widget fades in when its list opens, and stays while it is filtered.
  let first = index;
  while (suggest && first > 0 && completeStates[first - 1].suggest?.list === suggest.list) first--;
  const opened = completeStates[first].at;
  const appear = suggest ? ramp(local, opened, opened + 0.6) : 0;
  const label = suggest ? LABELS[suggest.list] : null;

  return (
    <>
      <Caption
        eyebrow="AUTOCOMPLETE"
        step={local}
        lines={[
          { at: 0, text: <>Autocomplete <G>that knows DROID.</G></> },
          { at: 40, text: "Only the jacks your rack really has." },
        ]}
      />
      <Shell>
        <Window width={f.w} height={f.h} status={{ errors: problems.length, position: `Ln ${caretLine + 1}, Col ${col + 1}` }}>
          <Group width="100%" tabs={[{ name: "melody.ini", active: true, errors: problems.length }]} actions={["graph", "hardware", "split", "more"]}>
            <Code
              lines={tokens(doc)}
              scroll={scroll}
              caret={{ line: caretLine, col }}
              squiggles={problems.map((p) => ({ line: p.line, from: p.startCol, to: p.endCol }))}
              overlay={(at) => {
                if (!suggest || !label) return null;
                const p = at(caretLine + 1, col - suggest.filter.length);
                const items = lists[suggest.list];
                const shown = Math.min(8, fuzzy(items, suggest.filter).length);
                const tag = vertical ? { x: Math.min(p.x - 26, f.w - M.activity - 436), y: p.y + shown * 22 + 10 } : { x: p.x - 26 + 444, y: p.y + 2 };
                return (
                  <>
                    <Suggest items={items} filter={suggest.filter} selected={suggest.selected} x={p.x} y={p.y} appear={appear} maxRight={f.w - M.activity} />
                    <div
                      style={{
                        position: "absolute",
                        left: tag.x,
                        top: tag.y,
                        padding: "4px 12px",
                        borderRadius: 999,
                        font: `600 13px ${theme.mono}`,
                        color: label.color,
                        background: `${label.color}1f`,
                        border: `1px solid ${label.color}77`,
                        opacity: appear,
                        transform: `translateX(${(1 - appear) * -10}px)`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {vertical ? "↑" : "←"} {label.text}
                    </div>
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
