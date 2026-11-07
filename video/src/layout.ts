// The video renders in two formats from the same scenes: 16:9 for YouTube and the
// website, 9:16 for Shorts, Reels and TikTok. Scenes read the format from here.
import { createContext, useContext } from "react";

export interface Layout {
  vertical: boolean;
  width: number;
  height: number;
  /** Left and right margin of captions and panels. */
  margin: number;
  /** Width between the margins. */
  content: number;
  /** Top of the caption block. */
  captionTop: number;
  /** Where panels start, below the caption. */
  top: number;
  /** Lowest point panels may reach (vertical keeps clear of the Shorts/Reels overlays). */
  bottom: number;
  /** Scale of the VS Code recreation (CSS pixels of the editor → video pixels). */
  ui: number;
}

export const landscape: Layout = {
  vertical: false,
  width: 1920,
  height: 1080,
  margin: 120,
  content: 1680,
  captionTop: 84,
  top: 268,
  bottom: 1030,
  ui: 1.75,
};
export const portrait: Layout = {
  vertical: true,
  width: 1080,
  height: 1920,
  margin: 56,
  content: 968,
  captionTop: 200,
  top: 560,
  bottom: 1640,
  ui: 1.8,
};

export const LayoutContext = createContext<Layout>(landscape);
export const useLayout = () => useContext(LayoutContext);
