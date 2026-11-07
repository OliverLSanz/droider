// Tokens shared with the website (site/assets/style.css).
import { loadFont as loadSans } from "@remotion/google-fonts/Geist";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const sans = loadSans("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });

export const theme = {
  bg: "#0B0D11",
  bg2: "#0F1217",
  surface: "#12151B",
  surface2: "#1A1F27",
  surface3: "#222833",
  line: "rgba(255,255,255,.08)",
  line2: "rgba(255,255,255,.14)",
  text: "#E9EDF3",
  muted: "#8D96A5",
  dim: "#646D7B",
  cyan: "#38BDF8",
  violet: "#A78BFA",
  pink: "#F472B6",
  green: "#34D399",
  amber: "#FBBF24",
  red: "#F87171",
  gradient: "linear-gradient(100deg, #38BDF8, #A78BFA 50%, #F472B6)",
  sans: `${sans.fontFamily}, -apple-system, "Segoe UI", sans-serif`,
  mono: `${mono.fontFamily}, SFMono-Regular, Menlo, monospace`,
  /** VS Code's own UI font on macOS. */
  ui: `-apple-system, BlinkMacSystemFont, "Segoe UI", ${sans.fontFamily}, sans-serif`,
};

/** Text filled with the patch-cable gradient. */
export const gradientText = {
  background: theme.gradient,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
} as const;
