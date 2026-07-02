import { test } from "bun:test";
import assert from "node:assert/strict";
import { createTestRenderer } from "@opentui/core/testing";
import { runTui } from "../src/tui/run.tsx";

test("runTui shows planning, then review, and resolves on quit", async () => {
  const testCtx = await createTestRenderer({ width: 80, height: 24 });
  let resolvePlan!: (plan: unknown) => void;
  const planPromise = new Promise((r) => { resolvePlan = r; });

  const resultPromise = runTui({
    planPromise: planPromise as Promise<never>,
    settings: { model: "claude-sonnet-4-6", effort: "low", verbose: false },
    deps: {
      commitOne: (c) => ({ subject: c.subject ?? "", files: c.files }),
      replan: async () => null,
      regenerateCommit: async () => null,
    },
    // Sync — no await gap before root.render() so renderOnce() captures the frame.
    makeRenderer: () => testCtx.renderer,
  });

  await testCtx.renderOnce();
  assert.match(testCtx.captureCharFrame(), /planning commits/);

  resolvePlan({ commits: [{ files: ["a.ts"], type: "feat", subject: "add a" }] });
  await new Promise((r) => setTimeout(r, 10));
  await testCtx.renderOnce();
  assert.match(testCtx.captureCharFrame(), /add a/);

  testCtx.mockInput.pressKey("q");
  const result = await resultPromise;
  assert.deepEqual(result.committed, []);
  testCtx.renderer.destroy();
});
