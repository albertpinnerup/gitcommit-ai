import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { App, type AppResult } from "../src/tui/app.tsx";
import { renderTui } from "./tui-helpers.ts";
import type { PlannedCommit } from "../src/types.ts";

const SETTINGS = { model: "claude-sonnet-4-6", effort: "low", verbose: false };

function makeApp(onDone: (r: AppResult) => void, overrides: Record<string, unknown> = {}) {
  const committed: string[] = [];
  const deps = {
    commitOne: (c: PlannedCommit) => {
      committed.push(c.subject ?? c.header ?? "");
      return { subject: c.subject ?? c.header ?? "", files: c.files };
    },
    replan: async () => null,
    regenerateCommit: async () => null,
  };
  const plan = {
    commits: [
      { files: ["a.ts"], type: "feat", subject: "add a" },
      { files: ["b.ts"], type: "fix", subject: "fix b" },
    ],
  };
  return {
    node: React.createElement(App, { plan, settings: SETTINGS, deps, height: 30, width: 80, onDone, ...overrides }),
    committedLog: committed,
  };
}

test("j/k moves the focus marker", async () => {
  const { node } = makeApp(() => {});
  const ui = await renderTui(node, { width: 80, height: 30 });
  await ui.press("j");
  assert.ok(ui.frame().split("\n").find((l) => l.includes("Commit 2"))?.includes("❯"));
  await ui.press("k");
  assert.ok(ui.frame().split("\n").find((l) => l.includes("Commit 1"))?.includes("❯"));
  ui.destroy();
});

test("s skips the focused commit", async () => {
  const { node } = makeApp(() => {});
  const ui = await renderTui(node, { width: 80, height: 30 });
  await ui.press("s");
  assert.doesNotMatch(ui.frame(), /add a/);
  assert.match(ui.frame(), /fix b/);
  ui.destroy();
});

test("enter commits the focused commit and shows progress", async () => {
  const { node, committedLog } = makeApp(() => {});
  const ui = await renderTui(node, { width: 80, height: 30 });
  await ui.press("return");
  assert.deepEqual(committedLog, ["add a"]);
  assert.match(ui.frame(), /committed 1: add a/);
  ui.destroy();
});

test("a commits everything and resolves", async () => {
  let result: AppResult | null = null;
  const { node, committedLog } = makeApp((r) => { result = r; });
  const ui = await renderTui(node, { width: 80, height: 30 });
  await ui.press("a");
  assert.deepEqual(committedLog, ["add a", "fix b"]);
  assert.equal(result!.committed.length, 2);
  ui.destroy();
});

test("q resolves with whatever was committed so far", async () => {
  let result: AppResult | null = null;
  const { node } = makeApp((r) => { result = r; });
  const ui = await renderTui(node, { width: 80, height: 30 });
  await ui.press("return");
  await ui.press("q");
  assert.equal(result!.committed.length, 1);
  assert.equal(result!.settings.model, "claude-sonnet-4-6");
  ui.destroy();
});

test("c opens settings; changes flow back on close", async () => {
  let result: AppResult | null = null;
  const { node } = makeApp((r) => { result = r; });
  const ui = await renderTui(node, { width: 80, height: 30 });
  await ui.press("c");
  assert.match(ui.frame(), /←\/→ change/);
  await ui.press("right");   // model -> claude-opus-4-8
  await ui.press("escape");  // close pane
  assert.match(ui.frame(), /Model: claude-opus-4-8/);
  await ui.press("q");
  assert.equal(result!.settings.model, "claude-opus-4-8");
  ui.destroy();
});

test("scroll-follow: focused commit stays visible after navigating deep into the list", async () => {
  // 40 commits with distinct subjects; height 20 gives a 7-row scrollbox.
  // Without scroll-follow, commits beyond the viewport would be invisible.
  const manyCommits = Array.from({ length: 40 }, (_, i) => ({
    files: [`f${i}.ts`],
    type: "feat",
    subject: `sub-${i}`,
  }));
  const { node } = makeApp(() => {}, {
    plan: { commits: manyCommits },
    height: 20,
  });
  const ui = await renderTui(node, { width: 80, height: 20 });
  // Move cursor 20 positions down (to commit index 20, subject "sub-20").
  await ui.press(...Array<string>(20).fill("j"));
  const frame = ui.frame();
  // The focused commit must be visible in the frame.
  assert.match(frame, /feat: sub-20/);
  ui.destroy();
});
