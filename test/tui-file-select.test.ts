import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { fileSelectReduce } from "../src/tui/file-select.ts";
import { FileSelectScreen } from "../src/tui/file-select-screen.tsx";
import { renderTui } from "./tui-helpers.ts";

test("fileSelectReduce toggles, navigates, and confirms the checked paths", () => {
  let s = { items: [{ path: "a", on: true }, { path: "b", on: false }], cursor: 0 };
  s = (fileSelectReduce(s, "down") as { state: typeof s }).state;
  s = (fileSelectReduce(s, " ") as { state: typeof s }).state;
  const done = fileSelectReduce(s, "enter");
  assert.deepEqual("selected" in done && done.selected, ["a", "b"]);
  assert.equal("cancelled" in fileSelectReduce(s, "escape"), true);
});

test("FileSelectScreen renders checkboxes, focus marker, and legend", async () => {
  const ui = await renderTui(React.createElement(FileSelectScreen, {
    state: { items: [{ path: "a.ts", on: true }, { path: "b.ts", on: false }], cursor: 1 },
  }));
  const frame = ui.frame();
  assert.match(frame, /\[x\] a.ts/);
  assert.match(frame, /\[ \] b.ts/);
  assert.ok(frame.split("\n").find((l) => l.includes("b.ts"))?.includes("❯"));
  assert.match(frame, /space toggle/);
  ui.destroy();
});
