/** @jsxImportSource @opentui/react */
// The ASCII title banner. Pure size logic is exported for direct testing;
// the component hides itself when the terminal is too narrow or too short
// (width-responsive, matching height-responsive behavior).

import { theme } from "./theme.ts";
import "./gradient-font.ts"; // registers the <gradientFont> element
// Measured from rendering "AI-commit" in "block" font at width=200, height=50
const BANNER_COLS = 76; // max character width of the rendered art
const BANNER_ROWS = 7; // 6 art rows + 1 row for marginBottom
const TITLE = "AI-commit";

export function shouldShowBanner(
  terminalWidth: number,
  terminalHeight: number,
  reservedRows: number,
): boolean {
  return (
    terminalHeight - reservedRows >= BANNER_ROWS + 1 &&
    terminalWidth >= BANNER_COLS
  );
}

export function Banner({ width, height }: { width: number; height: number }) {
  if (!shouldShowBanner(width, height, 12)) return null;
  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      {/* Same glyphs as <ascii-font font="block"> (6 art rows; BANNER_ROWS=7
          includes marginBottom), but colored per character: a left-to-right
          gradient between theme.bannerGradient stops, shadow layer auto-dimmed. */}
      <gradientFont text={TITLE} font="block" stops={theme.bannerGradient} />
    </box>
  );
}
