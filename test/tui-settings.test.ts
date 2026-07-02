import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { settingsReduce } from "../src/tui/settings.ts";
import { SettingsScreen } from "../src/tui/settings-screen.tsx";
import { renderTui } from "./tui-helpers.ts";

test("settingsReduce navigates fields and cycles values", () => {
  let s = { settings: { model: "claude-sonnet-4-6", effort: "low", verbose: false }, cursor: 0 };
  s = (settingsReduce(s, "right") as { state: typeof s }).state;
  assert.equal(s.settings.model, "claude-opus-4-8");
  s = (settingsReduce(s, "left") as { state: typeof s }).state;
  assert.equal(s.settings.model, "claude-sonnet-4-6");
  s = (settingsReduce(s, "down") as { state: typeof s }).state;
  s = (settingsReduce(s, "right") as { state: typeof s }).state;
  assert.equal(s.settings.effort, "medium");
  assert.equal("done" in settingsReduce(s, "escape"), true);
});

test("SettingsScreen renders fields, values, and legend", async () => {
  const ui = await renderTui(React.createElement(SettingsScreen, {
    state: { settings: { model: "claude-opus-4-8", effort: "high", verbose: true }, cursor: 1 },
  }));
  const frame = ui.frame();
  assert.match(frame, /model:\s+claude-opus-4-8/);
  assert.match(frame, /effort:\s+high/);
  assert.match(frame, /verbose:\s+on/);
  assert.ok(frame.split("\n").find((l) => l.includes("effort"))?.includes("❯"));
  assert.match(frame, /←\/→ change/);
  ui.destroy();
});
