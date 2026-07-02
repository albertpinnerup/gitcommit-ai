/** @jsxImportSource @opentui/react */
// The ASCII title banner. Pure size logic is exported for direct testing;
// the component hides itself when the terminal is too narrow or too short
// (width-responsive, matching height-responsive behavior).

import { theme } from "./theme.ts";

// Measured from rendering "AI-commit" in "block" font at width=200, height=50
const BANNER_COLS = 76; // max character width of the rendered art
const BANNER_ROWS = 7; // 6 art rows + 1 row for marginBottom
const TITLE = "AI-commit";

export function shouldShowBanner(terminalWidth: number, terminalHeight: number, reservedRows: number): boolean {
  return terminalHeight - reservedRows >= BANNER_ROWS + 1 && terminalWidth >= BANNER_COLS;
}

export function Banner({ width, height }: { width: number; height: number }) {
  if (!shouldShowBanner(width, height, 12)) return null;
  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      {/* ascii-font prop is "color" (not "fg") — verified against ASCIIFontOptions.
          font="tiny" only renders 2 rows; "block" renders 6 rows of art (BANNER_ROWS=7 includes marginBottom). */}
      <ascii-font text={TITLE} font="block" color={theme.accent} />
    </box>
  );
}
