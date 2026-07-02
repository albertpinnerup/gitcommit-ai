// The single adapter between tests and OpenTUI's test renderer. All TUI tests
// render through renderTui(); if @opentui's testing API drifts, fix it here.
//
// Installed API (verified against @opentui/core@0.4.2 / @opentui/react@0.4.2):
//   mockInput.pressKey(key)          — key is string | keyof KeyCodes
//   mockInput.pressArrow(direction)  — "up" | "down" | "left" | "right"
//   mockInput.pressEnter()
//   mockInput.pressEscape()
//   mockInput.pressBackspace()
//   mockInput.pressCtrlC()
//   mockInput.typeText(text)         — returns Promise<void>
//   captureCharFrame()               — returns the current rendered frame as a string
//   renderOnce()                     — flushes one OpenTUI render pass

import { testRender } from "@opentui/react/test-utils";
import type { MockInput } from "@opentui/core/testing";
import type { ReactNode } from "react";

export async function renderTui(
  node: ReactNode,
  { width = 80, height = 24 }: { width?: number; height?: number } = {},
) {
  const setup = await testRender(node, { width, height });
  // Flush the initial frame so captureCharFrame() has content immediately.
  await setup.renderOnce();

  return {
    frame(): string {
      return setup.captureCharFrame();
    },
    async press(...keys: string[]): Promise<void> {
      for (const key of keys) {
        pressKeyByName(setup.mockInput, key);
        await setup.renderOnce();
      }
    },
    async type(text: string): Promise<void> {
      await setup.mockInput.typeText(text);
      await setup.renderOnce();
    },
    resize(w: number, h: number): void {
      setup.resize(w, h);
    },
    destroy(): void {
      setup.renderer.destroy();
    },
  };
}

/**
 * Maps app-level key token names (matching toKey() output vocabulary) to
 * the appropriate mockInput call. Single characters fall through to pressKey.
 */
function pressKeyByName(mockInput: MockInput, key: string): void {
  switch (key) {
    case "up":
      mockInput.pressArrow("up");
      break;
    case "down":
      mockInput.pressArrow("down");
      break;
    case "left":
      mockInput.pressArrow("left");
      break;
    case "right":
      mockInput.pressArrow("right");
      break;
    case "enter":
    case "return":
      mockInput.pressEnter();
      break;
    case "escape":
      mockInput.pressEscape();
      break;
    case "backspace":
      mockInput.pressBackspace();
      break;
    case "ctrl-c":
      mockInput.pressCtrlC();
      break;
    default:
      // Single characters (including " ") and any other string go directly.
      mockInput.pressKey(key);
      break;
  }
}
