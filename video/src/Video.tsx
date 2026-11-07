import type { ComponentType } from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { LayoutContext, landscape, portrait } from "./layout";
import { SCENES, type SceneName } from "./score";
import { theme } from "./theme";
import { useStep } from "./timing";
import { Glow, sceneStyle } from "./ui";
import { Colour } from "./scenes/Colour";
import { Complete } from "./scenes/Complete";
import { Droider } from "./scenes/Droider";
import { Errors } from "./scenes/Errors";
import { Graph } from "./scenes/Graph";
import { Hardware } from "./scenes/Hardware";
import { Hook } from "./scenes/Hook";
import { HoverScene } from "./scenes/HoverScene";
import { Outro } from "./scenes/Outro";
import { Title } from "./scenes/Title";
import { Write } from "./scenes/Write";

/** Each scene, and whether it brings its own full-frame background (no shared transition). */
const scenes: { name: SceneName; component: ComponentType<{ step: number }>; own?: boolean }[] = [
  { name: "hook", component: Hook, own: true },
  { name: "title", component: Title, own: true },
  { name: "colour", component: Colour },
  { name: "complete", component: Complete },
  { name: "hover", component: HoverScene },
  { name: "errors", component: Errors },
  { name: "hardware", component: Hardware },
  { name: "graph", component: Graph },
  { name: "droider", component: Droider },
  { name: "write", component: Write },
  { name: "outro", component: Outro, own: true },
];

/** Scenes keep reading the absolute step, so their timing matches the score. */
export function Video({ vertical = false }: { vertical?: boolean }) {
  const step = useStep();
  return (
    <LayoutContext.Provider value={vertical ? portrait : landscape}>
      <AbsoluteFill style={{ background: theme.bg }}>
        <Audio src={staticFile("soundtrack.wav")} />
        {scenes.map(({ name, component: Scene, own }) => {
          const { from, to } = SCENES[name];
          const lead = own ? 0 : 2;
          if (step < from - lead || step >= to) return null;
          return own ? (
            <Scene key={name} step={step} />
          ) : (
            <div key={name} style={sceneStyle(step, from, to)}>
              <Glow strength={0.8} />
              <Scene step={step} />
            </div>
          );
        })}
      </AbsoluteFill>
    </LayoutContext.Provider>
  );
}
