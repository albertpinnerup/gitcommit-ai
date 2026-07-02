// Every color the TUI uses, in one place. Successor to styles() in ansi.ts.

const red = "#fe5b56";
const green = "#5bf68e";
const blue = "#56c1f8";
const yellow = "#f3f99d";
const cyan = "#00ffff";
const magenta = "#ff6ac1";
const white = "#ffffff";
const black = "#000000";
const gray = "#888888";

export const theme = {
  accent: blue,
  dim: gray,
  focusBg: white,
  focusFg: black,
  model: {
    "claude-sonnet-4-6": { fg: black, bg: yellow },
    "claude-opus-4-8": { fg: black, bg: green },
    "claude-haiku-4-5": { fg: black, bg: cyan },
  } as Record<string, { fg: string; bg: string }>,
  effortColor: {
    low: blue,
    medium: yellow,
    high: red,
  } as Record<string, string>,
  onColor: green,
  offColor: red,
  // Left-to-right gradient stops for the title banner.
  bannerGradient: [blue, magenta] as [string, string],
};
