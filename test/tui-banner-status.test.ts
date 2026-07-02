import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { Banner, shouldShowBanner } from "../src/tui/banner.tsx";
import { Status, statusText } from "../src/tui/status.tsx";
import { renderTui } from "./tui-helpers.ts";

test("shouldShowBanner hides the banner when the terminal is short", () => {
  assert.equal(shouldShowBanner(120, 24, 12), true);
  assert.equal(shouldShowBanner(120, 14, 12), false); // banner (~7 rows) + chrome won't fit
});

test("shouldShowBanner hides the banner when the terminal is too narrow", () => {
  assert.equal(shouldShowBanner(75, 24, 12), false); // just under BANNER_COLS (76)
  assert.equal(shouldShowBanner(76, 24, 12), true); // exactly BANNER_COLS
});

test("shouldShowBanner height boundary at exact cutover with reservedRows=12", () => {
  // BANNER_ROWS=7, reservedRows=12, so min height = 12 + 7 + 1 = 20
  assert.equal(shouldShowBanner(120, 20, 12), true, "should fit at exact minimum");
  assert.equal(shouldShowBanner(120, 19, 12), false, "should not fit one row below");
});

test("Banner renders ascii art rows on a tall, wide terminal", async () => {
  const ui = await renderTui(React.createElement(Banner, { width: 120, height: 24 }));
  const rows = ui.frame().split("\n").filter((row) => row.trim() !== "");
  assert.ok(rows.length >= 3, `expected ascii-art rows, got ${rows.length}`);
  assert.ok(rows.some((r) => /[█╔╚╝═║]/.test(r)), "expected block glyphs in banner art");
  ui.destroy();
});

test("Banner renders nothing on a narrow terminal", async () => {
  const ui = await renderTui(React.createElement(Banner, { width: 10, height: 24 }), {
    width: 10,
    height: 24,
  });
  assert.equal(ui.frame().trim(), "");
  ui.destroy();
});

test("Banner renders nothing on a short terminal", async () => {
  const ui = await renderTui(React.createElement(Banner, { width: 120, height: 10 }), {
    height: 10,
  });
  assert.equal(ui.frame().trim(), "");
  ui.destroy();
});

test("statusText formats the elapsed label", () => {
  assert.equal(statusText(0, "planning commits"), "commit · 0s · planning commits");
  assert.equal(statusText(7, ""), "commit · 7s · working…");
});

test("Status renders the label with full format", async () => {
  const ui = await renderTui(
    React.createElement(Status, { label: "planning commits", startedAt: Date.now() }),
  );
  assert.match(ui.frame(), /commit · \d+s · planning commits/);
  ui.destroy();
});
