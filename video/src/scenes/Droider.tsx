// Level up: a megacircuit blueprint, used twice in duet.droider, free arithmetic,
// and Build, which writes the plain dist/duet.ini the module can load.
import { Easing } from "remotion";
import { docs, patch, tokens } from "../data";
import { cableColor } from "../highlight";
import { useLayout } from "../layout";
import { BUILD_CLICK, SCENES } from "../score";
import { theme } from "../theme";
import { lerp, ramp } from "../timing";
import { Caption, G, Path } from "../ui";
import { Code, Explorer, Group, HoverCard, M, Markdown, Toast, Window, type Mark } from "../vscode/Editor";
import * as I from "../vscode/Icons";
import { Shell, useFrame } from "./Shell";

const pluck = tokens(docs.pluck, "blueprint");
const duet = tokens(docs.duet, "droider");
const ini = tokens(docs.duetIni, "ini");
const duetLines = docs.duet.split("\n");
const iniLines = docs.duetIni.split("\n");
const pluckLines = docs.pluck.split("\n");

const PLUCKS = duetLines.flatMap((l, i) => (l === "[pluck]" ? [i] : []));
const MATHS = duetLines.findIndex((l) => l.includes("(_ENV_LEAD"));
const INPUT = pluckLines.indexOf("[input]");
const OUTPUT = pluckLines.indexOf("[output]");
const BODY = pluckLines.indexOf("[euklid]");
const MATH1 = iniLines.findIndex((l) => l.includes("output = _MATH1"));

/** Every occurrence of the renamed private cables, and of the maths steps, in dist/duet.ini. */
function iniMarks(local: number): Mark[] {
  const out: Mark[] = [];
  const renamed = ramp(local, 67, 68.5) * (1 - ramp(local, 75, 76));
  const maths = ramp(local, 78.5, 80);
  iniLines.forEach((l, line) => {
    const re = /__pluck_\d_[A-Za-z]+|_MATH1/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l))) {
      const level = m[0] === "_MATH1" ? maths : renamed;
      if (level > 0) out.push({ line, from: m.index, to: m.index + m[0].length, color: cableColor(m[0]), opacity: level * 0.25 });
    }
  });
  return out;
}

export function Droider({ step }: { step: number }) {
  const { vertical } = useLayout();
  const f = useFrame();
  const local = step - SCENES.droider.from;
  const sidebar = !vertical;
  const area = { w: f.w - M.activity - (sidebar ? M.sidebar : 0), h: f.h - M.status };
  const codeLeft = M.activity + (sidebar ? M.sidebar : 0) + 1;

  const onDuet = local >= 22;
  const build = local >= BUILD_CLICK - SCENES.droider.from + 0.6;
  const split = ramp(local, 63, 66, Easing.inOut(Easing.cubic));
  const firstSize = vertical ? lerp(area.h, area.h * 0.42, split) : lerp(area.w, area.w * 0.5, split);

  const duetScroll = vertical
    ? lerp(4, 8, ramp(local, 44, 48, Easing.inOut(Easing.cubic))) + 14 * split
    : lerp(5, MATHS - 12, ramp(local, 44, 48, Easing.inOut(Easing.cubic)));
  const iniScroll = lerp(11, MATH1 - 9, ramp(local, 75, 78.5, Easing.inOut(Easing.cubic)));

  const hover = ramp(local, 29, 30) * (1 - ramp(local, 43, 44));
  const pluckAt = { x: codeLeft + M.gutter + 4 * M.char, y: M.tabs + 4 + (PLUCKS[0] - (vertical ? 4 : 5)) * M.line + 12 };
  const buildIcon = { x: (vertical ? f.w : codeLeft - 1 + firstSize) - 122, y: 18 };

  const blueprintMarks: Mark[] = [
    ...Array.from({ length: OUTPUT - INPUT - 1 }, (_, k) => ({ line: INPUT + k, from: 0, to: 30, color: "#4FC1FF", opacity: ramp(local, 3, 4.5) * (1 - ramp(local, 18, 20)) * 0.1 })),
    ...Array.from({ length: BODY - OUTPUT - 1 }, (_, k) => ({ line: OUTPUT + k, from: 0, to: 30, color: "#C586C0", opacity: ramp(local, 7, 8.5) * (1 - ramp(local, 18, 20)) * 0.12 })),
  ];
  const duetMarks: Mark[] = [
    ...PLUCKS.map((line, k) => ({ line, from: 0, to: 7, color: "#DCDCAA", opacity: ramp(local, 24 + k, 25 + k) * (1 - ramp(local, 44, 46)) * 0.22 })),
    { line: MATHS, from: 4, to: duetLines[MATHS].length, color: "#A78BFA", opacity: ramp(local, 47.5, 49) * (1 - ramp(local, 76, 78)) * 0.25 },
  ];

  const tabs = onDuet
    ? [{ name: "pluck.blueprint" }, { name: "duet.droider", active: true }]
    : [{ name: "melody.ini" }, { name: "pluck.blueprint", active: true }];

  return (
    <>
      <Caption
        eyebrow="LEVEL UP · .DROIDER"
        color={theme.violet}
        step={local}
        lines={[
          { at: 0, text: <>Level up with <G>.droider</G> files.</> },
          { at: 9, text: "Turn a sub-patch into a megacircuit." },
          { at: 23, text: "Use it like any circuit. Twice." },
          { at: 46, text: <>Write <G>free arithmetic.</G></> },
          { at: 62, text: "Build: a plain .ini for the card." },
        ]}
      />
      <Shell>
        <Window
          width={f.w}
          height={f.h}
          sidebar={sidebar ? <Explorer active={build ? "duet.ini" : onDuet ? "duet.droider" : "pluck.blueprint"} /> : false}
          status={{
            position: onDuet ? `Ln ${PLUCKS[0] + 1}, Col 3` : "Ln 1, Col 1",
            language: onDuet ? "DROID Patch (with sugar)" : "DROID Megacircuit Blueprint",
            card: onDuet ? "write" : "card",
          }}
        >
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: vertical ? "100%" : firstSize, height: vertical ? firstSize : "100%", display: "flex" }}>
              <Group width="100%" tabs={tabs} actions={onDuet ? ["build", "graph", "hardware", "split", "more"] : ["split", "more"]}>
                {onDuet ? (
                  <Code
                    lines={duet}
                    scroll={duetScroll}
                    caret={{ line: PLUCKS[0], col: 2 }}
                    caretVisible={false}
                    marks={duetMarks}
                    overlay={(at) =>
                      hover > 0 ? (
                        <HoverCard x={at(PLUCKS[0], 0).x - 4} y={at(PLUCKS[0], 0).y - 2} width={560} appear={hover} maxRight={firstSize}>
                          <Markdown md={patch.hover.pluck} />
                        </HoverCard>
                      ) : null
                    }
                  />
                ) : (
                  <Code lines={pluck} scroll={0} caret={{ line: 0, col: 0 }} caretVisible={false} marks={blueprintMarks} />
                )}
              </Group>
            </div>
            {split > 0 ? (
              <div
                style={{
                  position: "absolute",
                  left: vertical ? 0 : firstSize,
                  top: vertical ? firstSize : 0,
                  width: vertical ? "100%" : area.w - firstSize,
                  height: vertical ? area.h - firstSize : "100%",
                  display: "flex",
                  opacity: ramp(local, 63.5, 65.5),
                }}
              >
                <Group width="100%" tabs={[{ name: "duet.ini", active: true }]} actions={["graph", "hardware", "split", "more"]}>
                  <Code lines={ini} scroll={iniScroll} caret={null} marks={iniMarks(local)} />
                </Group>
              </div>
            ) : null}
            <Toast appear={ramp(local, 64.5, 65.5) * (1 - ramp(local, 84, 86))} width={vertical ? 300 : 290}>
              <I.Info size={16} />
              <span>{patch.messages.built}</span>
            </Toast>
          </div>
        </Window>
        {onDuet ? (
          <>
            <Path
              step={local}
              stops={[
                { at: 25, x: pluckAt.x + 200, y: pluckAt.y + 120 },
                { at: 28, x: pluckAt.x, y: pluckAt.y },
                { at: 42, x: pluckAt.x, y: pluckAt.y },
              ]}
              fadeOut={0.5}
            />
            <Path
              step={local}
              stops={[
                { at: 57, x: buildIcon.x - 70, y: buildIcon.y + 110 },
                { at: BUILD_CLICK - SCENES.droider.from, x: buildIcon.x, y: buildIcon.y, click: true },
              ]}
              fadeOut={2}
            />
          </>
        ) : null}
      </Shell>
    </>
  );
}
