import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { toKey } from "../src/tui/keys.ts";
import { renderTui } from "./tui-helpers.ts";

test("toKey normalizes OpenTUI events to app tokens", () => {
  assert.equal(toKey({ name: "up" }), "up");
  assert.equal(toKey({ name: "return" }), "enter");
  assert.equal(toKey({ name: "escape" }), "escape");
  assert.equal(toKey({ name: "c", ctrl: true }), "ctrl-c");
  assert.equal(toKey({ name: "space", sequence: " " }), " ");
  assert.equal(toKey({ name: "j", sequence: "j" }), "j");
  assert.equal(toKey({ name: "backspace" }), "backspace");
});

test("renderTui renders a component and captures the frame", async () => {
  const ui = await renderTui(React.createElement("text", null, "hello tui"));
  assert.match(ui.frame(), /hello tui/);
  ui.destroy();
});
