import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { App, type AppResult } from "../src/tui/app.tsx";
import { renderTui } from "./tui-helpers.ts";
import type { PlannedCommit } from "../src/types.ts";

const SETTINGS = { model: "claude-sonnet-4-6", effort: "low", verbose: false };

function makeApp(onDone: (r: AppResult) => void = () => {}) {
  const deps = {
    commitOne: (c: PlannedCommit) => ({ subject: c.subject ?? c.header ?? "", files: c.files }),
    replan: async () => null,
    regenerateCommit: async () => null,
  };
  const plan = {
    commits: [
      { files: ["a.ts", "b.ts"], type: "feat", subject: "add things" },
    ],
  };
  return React.createElement(App, { plan, settings: SETTINGS, deps, height: 30, width: 80, onDone });
}

test("e edits the header and stores it verbatim", async () => {
  const ui = await renderTui(makeApp(), { height: 30 });
  await ui.press("e");
  assert.match(ui.frame(), /feat: add things/); // prefilled with full header
  await ui.type("!");
  await ui.press("return");
  assert.match(ui.frame(), /feat: add things!/);
  ui.destroy();
});

test("E edits the body with \\n escaping", async () => {
  const ui = await renderTui(makeApp(), { height: 30 });
  await ui.press("E");
  await ui.type("one\\ntwo");
  await ui.press("return");
  const frame = ui.frame();
  assert.match(frame, /one/);
  assert.match(frame, /two/);
  ui.destroy();
});

test("escape cancels an edit without changes", async () => {
  const ui = await renderTui(makeApp(), { height: 30 });
  await ui.press("e");
  await ui.type("XXX");
  await ui.press("escape");
  assert.doesNotMatch(ui.frame(), /XXX/);
  assert.match(ui.frame(), /feat: add things/);
  ui.destroy();
});

test("n picks files then a message and prepends the new commit", async () => {
  const ui = await renderTui(makeApp(), { height: 30 });
  await ui.press("n");
  assert.match(ui.frame(), /Pick files/);
  // a.ts and b.ts are pre-checked (seeded from focused commit); uncheck b.ts:
  await ui.press("down");
  await ui.press("space");
  await ui.press("return");
  // message editor, prefilled with the focused commit's header — replace it:
  await ui.type(" split");
  await ui.press("return");
  const frame = ui.frame();
  assert.match(frame, /Commit 1/);
  assert.match(frame, /add things split/);   // new commit is first
  assert.match(frame, /files: a.ts/);
  ui.destroy();
});
