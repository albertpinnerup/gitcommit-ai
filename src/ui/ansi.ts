// ANSI terminal styling helpers, shared by every screen the tool renders.

type Style = (text: string) => string;

const wrap = (code: string): Style => (text) => `\x1b[${code}m${text}\x1b[0m`;

export interface Styles {
  invert: Style;
  dim: Style;
  accent: Style;
  bold: Style;
}

// styles(useColor) -> named styling functions. When useColor is false they pass
// the text through unchanged, which keeps rendered output assertable in tests.
export function styles(useColor = true): Styles {
  const style = (code: string): Style => (useColor ? wrap(code) : (text) => text);
  return {
    invert: style("7"),
    dim: style("2"),
    accent: style("36"),
    bold: style("1"),
  };
}

// clampToWidth(text, width) -> text truncated to `width` columns with a trailing
// ellipsis. A falsy width means "no limit". Used so long lines never wrap (a
// wrapped line would desync the cursor-based redraw of the picker).
export function clampToWidth(text: string, width: number): string {
  if (!width || text.length <= width) return text;
  return text.slice(0, Math.max(0, width - 1)) + "…";
}
