import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { LineEditor } from "../src/tui/line-editor.tsx";
import { renderTui } from "./tui-helpers.ts";

test("shows the prompt and the prefilled value", async () => {
  const ui = await renderTui(React.createElement(LineEditor, {
    prompt: "edit message:", initial: "feat: hello", onSave: () => {}, onCancel: () => {},
  }));
  assert.match(ui.frame(), /edit message:/);
  assert.match(ui.frame(), /feat: hello/);
  ui.destroy();
});

test("enter saves the edited value", async () => {
  let saved: string | null = null;
  const ui = await renderTui(React.createElement(LineEditor, {
    prompt: "p:", initial: "abc", onSave: (v: string) => { saved = v; }, onCancel: () => {},
  }));
  await ui.type("!");
  await ui.press("return");
  assert.equal(saved, "abc!");
  ui.destroy();
});

test("escape cancels without saving", async () => {
  let saved = false, cancelled = false;
  const ui = await renderTui(React.createElement(LineEditor, {
    prompt: "p:", initial: "abc", onSave: () => { saved = true; }, onCancel: () => { cancelled = true; },
  }));
  await ui.press("escape");
  assert.equal(saved, false);
  assert.equal(cancelled, true);
  ui.destroy();
});
