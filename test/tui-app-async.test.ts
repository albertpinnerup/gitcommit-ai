import { test } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { App, type AppResult } from "../src/tui/app.tsx";
import { renderTui } from "./tui-helpers.ts";
import type { PlannedCommit, Settings } from "../src/types.ts";

const SETTINGS = { model: "claude-sonnet-4-6", effort: "low", verbose: false };
const PLAN = {
  commits: [
    { files: ["a.ts"], type: "feat", subject: "add a" },
    { files: ["b.ts"], type: "fix", subject: "fix b" },
  ],
};

function app(deps: Record<string, unknown>, onDone: (r: AppResult) => void = () => {}) {
  const base = {
    commitOne: (c: PlannedCommit) => ({ subject: c.subject ?? "", files: c.files }),
    replan: async () => null,
    regenerateCommit: async () => null,
  };
  return React.createElement(App, {
    plan: PLAN, settings: SETTINGS, deps: { ...base, ...deps }, height: 30, width: 80, onDone,
  });
}

test("R regenerates the focused commit, keeping its files", async () => {
  const ui = await renderTui(app({
    regenerateCommit: async () => ({ type: "chore", subject: "rewritten" }),
  }), { height: 30 });
  await ui.press("R");
  await new Promise((r) => setTimeout(r, 10)); // let the async resolve
  await ui.press("j"); // any key -> forces a fresh frame after state settles
  const frame = ui.frame();
  assert.match(frame, /chore: rewritten/);
  assert.match(frame, /files: a.ts/);
  ui.destroy();
});

test("p sends an instruction to replan and swaps in the new plan", async () => {
  let seen: string | undefined;
  const ui = await renderTui(app({
    replan: async (_s: Settings, instruction?: string) => {
      seen = instruction;
      return { commits: [{ files: ["z.ts"], type: "feat", subject: "replanned" }] };
    },
  }), { height: 30 });
  await ui.press("p");
  await ui.type("split by feature");
  await ui.press("return");
  await new Promise((r) => setTimeout(r, 10));
  await ui.press("k");
  assert.equal(seen, "split by feature");
  assert.match(ui.frame(), /replanned/);
  ui.destroy();
});

test("r then g regroups via replan", async () => {
  const ui = await renderTui(app({
    replan: async () => ({ commits: [{ files: ["z.ts"], type: "feat", subject: "regrouped" }] }),
  }), { height: 30 });
  await ui.press("r");
  assert.match(ui.frame(), /regroup/); // chooser visible
  await ui.press("g");
  await new Promise((r) => setTimeout(r, 10));
  await ui.press("k");
  assert.match(ui.frame(), /regrouped/);
  ui.destroy();
});

test("r then m rewrites every message in place", async () => {
  let calls = 0;
  const ui = await renderTui(app({
    regenerateCommit: async (c: PlannedCommit) => {
      calls++;
      return { type: "docs", subject: `rewritten ${c.files[0]}` };
    },
  }), { height: 30 });
  await ui.press("r");
  await ui.press("m");
  await new Promise((r) => setTimeout(r, 20));
  await ui.press("k");
  assert.equal(calls, 2);
  assert.match(ui.frame(), /rewritten a.ts/);
  assert.match(ui.frame(), /rewritten b.ts/);
  ui.destroy();
});

test("failed replan keeps the old plan", async () => {
  const ui = await renderTui(app({ replan: async () => null }), { height: 30 });
  await ui.press("r");
  await ui.press("g");
  await new Promise((r) => setTimeout(r, 10));
  await ui.press("k");
  assert.match(ui.frame(), /add a/);
  ui.destroy();
});

test("error in replan shows error message and keeps the old plan", async () => {
  const ui = await renderTui(app({
    replan: async () => { throw new Error("claude is unavailable"); },
  }), { height: 30 });
  await ui.press("r");
  await ui.press("g");
  await new Promise((r) => setTimeout(r, 10));
  await ui.press("k");
  const frame = ui.frame();
  assert.match(frame, /claude is unavailable/);
  assert.match(frame, /add a/); // old plan intact
  ui.destroy();
});

test("empty instruction aborts back to review with the plan unchanged", async () => {
  let replanCalls = 0;
  const ui = await renderTui(app({ replan: async () => { replanCalls++; return null; } }), { height: 30 });
  await ui.press("p");
  await ui.press("return");   // submit the empty prefill
  await new Promise((r) => setTimeout(r, 10));
  const frame = ui.frame();
  assert.match(frame, /add a/);            // old plan intact, review visible
  assert.doesNotMatch(frame, /tell Claude what to change/); // not stuck in the editor
  assert.equal(replanCalls, 0);            // replan never invoked
  ui.destroy();
});

test("R with a null regeneration leaves the commit unchanged", async () => {
  const ui = await renderTui(app({ regenerateCommit: async () => null }), { height: 30 });
  await ui.press("R");
  await new Promise((r) => setTimeout(r, 10));
  await ui.press("j");
  const frame = ui.frame();
  assert.match(frame, /feat: add a/);
  assert.match(frame, /files: a.ts/);
  ui.destroy();
});
