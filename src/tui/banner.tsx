/** @jsxImportSource @opentui/react */
// The ASCII title banner. Pure size logic is exported for direct testing;
// the component hides itself when the terminal is too short (the same
// responsive behavior the figlet version had, without the arithmetic).

import { theme } from "./theme.ts";

const BANNER_ROWS = 6; // ascii font height + margin row
const TITLE = "AI-commit";

export function shouldShowBanner(terminalHeight: number, reservedRows: number): boolean {
  return terminalHeight - reservedRows >= BANNER_ROWS + 2;
}

export function Banner({ height }: { height: number }) {
  if (!shouldShowBanner(height, 12)) return null;
  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      {/* ascii-font prop is "color" (not "fg") — verified against ASCIIFontOptions.
          font="tiny" only renders 2 rows; "block" renders 6 (matching BANNER_ROWS=6). */}
      <ascii-font text={TITLE} font="block" color={theme.accent} />
    </box>
  );
}
