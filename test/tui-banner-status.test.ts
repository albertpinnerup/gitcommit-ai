import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { Banner, shouldShowBanner } from "../src/tui/banner.tsx";
import { Status, statusText } from "../src/tui/status.tsx";
import { renderTui } from "./tui-helpers.ts";

test("shouldShowBanner hides the banner when the terminal is short", () => {
  assert.equal(shouldShowBanner(24, 12), true);
  assert.equal(shouldShowBanner(14, 12), false); // banner (~6 rows) + chrome won't fit
});

test("Banner renders ascii art rows on a tall terminal", async () => {
  const ui = await renderTui(React.createElement(Banner, { height: 24 }));
  const rows = ui.frame().split("\n").filter((row) => row.trim() !== "");
  assert.ok(rows.length >= 3, `expected ascii-art rows, got ${rows.length}`);
  ui.destroy();
});

test("Banner renders nothing on a short terminal", async () => {
  const ui = await renderTui(React.createElement(Banner, { height: 10 }), { height: 10 });
  assert.equal(ui.frame().trim(), "");
  ui.destroy();
});

test("statusText formats the elapsed label", () => {
  assert.equal(statusText(0, "planning commits"), "commit · 0s · planning commits");
  assert.equal(statusText(7, ""), "commit · 7s · working…");
});

test("Status renders the label", async () => {
  const ui = await renderTui(
    React.createElement(Status, { label: "planning commits", startedAt: Date.now() }),
  );
  assert.match(ui.frame(), /planning commits/);
  ui.destroy();
});
