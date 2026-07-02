import { test } from "bun:test";
import assert from "node:assert/strict";
import { createTestRenderer } from "@opentui/core/testing";
import { main } from "../src/commands/commit.ts";
import { demoDeps } from "../src/demo/index.ts";
import { SCENARIOS } from "../src/demo/fixtures.ts";
import type { Settings, OutputStream } from "../src/types.ts";

test("main() interactive: commit-all via injected renderer resolves with code 0", async () => {
  const testCtx = await createTestRenderer({ width: 80, height: 24 });

  let savedSettings: Settings | null = null;
  let outputText = "";

  const mockOutput: OutputStream = {
    write: (text: string) => { outputText += text; },
    isTTY: false,
  };

  const deps = {
    ...demoDeps("single"),
    // Override callClaude to return immediately (no 350ms demo delay in tests).
    callClaude: async () => JSON.stringify(SCENARIOS.single.plan),
    // Inject the test renderer so the interactive branch is entered without a real TTY.
    makeRenderer: () => testCtx.renderer,
    saveSettings: (s: Settings) => { savedSettings = s; },
    output: mockOutput,
  };

  const mainPromise = main([], deps);

  // Allow the plan promise to settle and React to process the state update.
  await new Promise((r) => setTimeout(r, 20));
  await testCtx.renderOnce();

  // Review screen is now visible; commit everything.
  testCtx.mockInput.pressKey("a");

  const code = await mainPromise;

  assert.equal(code, 0, "exit code should be 0");
  assert.ok(savedSettings !== null, "saveSettings should have been called");
  assert.match(outputText, /Created 1 commit/, "output should report the committed count");

  testCtx.renderer.destroy();
});
