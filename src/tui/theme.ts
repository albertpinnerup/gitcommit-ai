// Every color the TUI uses, in one place. Successor to styles() in ansi.ts.

export const theme = {
  accent: "#00FFFF",
  dim: "#777777",
  focusBg: "#FFFFFF",
  focusFg: "#000000",
  model: {
    "claude-sonnet-4-6": { fg: "#000000", bg: "#FFFF00" },
    "claude-opus-4-8": { fg: "#000000", bg: "#00FF00" },
    "claude-haiku-4-5": { fg: "#000000", bg: "#00FFFF" },
  } as Record<string, { fg: string; bg: string }>,
  effortColor: {
    low: "#5555FF",
    medium: "#FF55FF",
    high: "#FF5555",
  } as Record<string, string>,
  onColor: "#00FF00",
  offColor: "#FF0000",
};
