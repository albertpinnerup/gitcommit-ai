import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { ReviewScreen } from "../src/tui/review-screen.tsx";
import { renderTui } from "./tui-helpers.ts";

const SETTINGS = { model: "claude-sonnet-4-6", effort: "low", verbose: false };
const COMMITS = [
  { files: ["a.ts"], type: "feat", subject: "add a" },
  { files: ["b.ts", "c.ts"], type: "fix", subject: "fix b", body: "line one\nline two" },
];

function screen(overrides: Record<string, unknown> = {}) {
  return React.createElement(ReviewScreen, {
    commits: COMMITS, cursor: 0, committed: [], settings: SETTINGS, height: 30, width: 80,
    ...overrides,
  });
}

test("renders commit labels, subjects, files, and legend", async () => {
  const ui = await renderTui(screen(), { height: 30 });
  const frame = ui.frame();
  assert.match(frame, /Commit 1/);
  assert.match(frame, /feat: add a/);
  assert.match(frame, /fix: fix b/);
  assert.match(frame, /files: b.ts, c.ts/);
  assert.match(frame, /enter accept/);
  ui.destroy();
});

test("focused commit gets the marker", async () => {
  const ui = await renderTui(screen({ cursor: 1 }), { height: 30 });
  const focusedLine = ui.frame().split("\n").find((l) => l.includes("Commit 2"));
  assert.ok(focusedLine?.includes("❯"));
  ui.destroy();
});

test("shows verbose body lines and the settings block", async () => {
  const ui = await renderTui(screen(), { height: 30 });
  const frame = ui.frame();
  assert.match(frame, /line one/);
  assert.match(frame, /Model: claude-sonnet-4-6/);
  assert.match(frame, /Effort: low/);
  ui.destroy();
});

test("shows committed progress", async () => {
  const ui = await renderTui(
    screen({ committed: [{ subject: "add a", files: ["a.ts"] }] }),
    { height: 30 },
  );
  assert.match(ui.frame(), /committed 1: add a/);
  ui.destroy();
});

test("long commit lists overflow into the scrollbox without breaking the footer", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    files: [`f${i}.ts`], type: "feat", subject: `commit ${i}`,
  }));
  const ui = await renderTui(screen({ commits: many, cursor: 0, height: 20 }), { height: 20 });
  const frame = ui.frame();
  assert.match(frame, /commit 0/);       // focused item visible
  assert.match(frame, /enter accept/);   // footer still on screen
  ui.destroy();
});
