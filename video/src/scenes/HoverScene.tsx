// Hover docs: a parameter, then a circuit, explained in place.
import { Easing } from "remotion";
import { docs, lineOf, patch, tokens } from "../data";
import { useLayout } from "../layout";
import { SCENES } from "../score";
import { ramp } from "../timing";
import { Caption, Path } from "../ui";
import { Code, Group, HoverCard, M, Markdown, Window } from "../vscode/Editor";
import { Shell, useFrame } from "./Shell";

const doc = docs.melody;
const highlighted = tokens(doc);
const BEATS = lineOf(doc, (l) => l.startsWith("    beats"));
const MINI = lineOf(doc, (l) => l === "[minifonion]");

export function HoverScene({ step }: { step: number }) {
  const f = useFrame();
  const { vertical } = useLayout();
  const local = step - SCENES.hover.from;
  const scroll = BEATS - (vertical ? 12 : 9) + (MINI - BEATS) * ramp(local, 12.5, 16.5, Easing.inOut(Easing.cubic));
  const first = ramp(local, 4.2, 5) * (1 - ramp(local, 12, 12.8));
  const second = ramp(local, 18.8, 19.6);
  const hovering = local < 12.5 ? BEATS : MINI;

  return (
    <>
      <Caption
        eyebrow="HOVER DOCS"
        step={local}
        lines={[
          { at: 0, text: "The manual, under your pointer." },
          { at: 17, text: "Every circuit, parameter and jack." },
        ]}
      />
      <Shell>
        <Window width={f.w} height={f.h} status={{ position: `Ln ${hovering + 1}, Col 5` }}>
          <Group width="100%" tabs={[{ name: "melody.ini", active: true }]} actions={["graph", "hardware", "split", "more"]}>
            <Code
              lines={highlighted}
              scroll={scroll}
              caret={{ line: hovering, col: hovering === BEATS ? 5 : 3 }}
              caretVisible={false}
              marks={[
                { line: BEATS, from: 4, to: 9, color: "#ffffff", opacity: first * 0.1 },
                { line: MINI, from: 1, to: 11, color: "#ffffff", opacity: second * 0.1 },
              ]}
              overlay={(at) => {
                const b = at(BEATS, 6.5);
                const m = at(MINI, 5.5);
                return (
                  <>
                    {first > 0 ? (
                      <HoverCard x={at(BEATS, 4).x - 8} y={at(BEATS, 0).y - 2} width={560} appear={first} maxRight={f.w - M.activity}>
                        <Markdown md={patch.hover.beats} />
                      </HoverCard>
                    ) : null}
                    {second > 0 ? (
                      <HoverCard x={at(MINI, 1).x - 8} y={at(MINI, 0).y - 2} width={600} appear={second} maxRight={f.w - M.activity}>
                        <Markdown md={patch.hover.minifonion} maxParagraphs={vertical ? 2 : 3} />
                      </HoverCard>
                    ) : null}
                    <Path
                      step={local}
                      stops={[
                        { at: 0.5, x: b.x + 120, y: b.y + 90 },
                        { at: 3.2, x: b.x, y: b.y + 10 },
                        { at: 12, x: b.x, y: b.y + 10 },
                        { at: 18, x: m.x, y: m.y + 10 },
                      ]}
                      fadeOut={20}
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
