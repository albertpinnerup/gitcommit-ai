// ANSI terminal styling helpers, shared by every screen the tool renders.
//
// The one rule: the `useColor` decision lives HERE and nowhere else. Render
// functions destructure ready-made style functions from styles(color) and never
// check the flag themselves — when color is off every style is a pass-through,
// which keeps piped/test output plain and assertable.

import chalk from "chalk";
import { pastel } from "gradient-string";

type Style = (text: string) => string;

const identity: Style = (text) => text;

const wrap =
  (code: string): Style =>
  (text) =>
    `\x1b[${code}m${text}\x1b[0m`;

export interface Styles {
  invert: Style;
  dim: Style;
  accent: Style;
  bold: Style;
  // paint(chalkStyle) -> that style when color is on, pass-through when off.
  // Lets callers use any chalk style without their own color checks.
  paint: (style: Style) => Style;
  // chip(chalkStyle) -> a padded " value " badge when color is on (padding only
  // makes sense with a background colour), the bare text when off.
  chip: (style: Style) => Style;
  // banner(rows) -> the rows painted with a multi-line gradient. Takes and
  // returns an array so callers keep their one-element-per-terminal-row shape.
  banner: (rows: string[]) => string[];
}

// styles(useColor) -> named styling functions. When useColor is false they pass
// the text through unchanged, which keeps rendered output assertable in tests.
export function styles(useColor = true): Styles {
  const style = (code: string): Style => (useColor ? wrap(code) : identity);
  const paint = (s: Style): Style => (useColor ? s : identity);
  return {
    invert: style("7"),
    dim: style("2"),
    accent: style("36"),
    bold: paint(chalk.blue),
    paint,
    chip: (s) => (useColor ? (text) => s(` ${text} `) : identity),
    banner: useColor
      ? (rows) =>
          rows.length ? pastel.multiline(rows.join("\n")).split("\n") : rows
      : (rows) => rows,
  };
}

// clampToWidth(text, width) -> text truncated to `width` columns with a trailing
// ellipsis. A falsy width means "no limit". Used so long lines never wrap (a
// wrapped line would desync the cursor-based redraw of the picker).
export function clampToWidth(text: string, width: number): string {
  if (!width || text.length <= width) return text;
  return text.slice(0, Math.max(0, width - 1)) + "…";
}
