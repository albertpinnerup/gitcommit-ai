# OpenTUI Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the gitcommit-ai terminal UI as OpenTUI React components on a `opentui-rewrite` branch, with the whole toolchain migrated to Bun.

**Architecture:** Everything drawn to a TTY becomes a React component under one root (`src/tui/`); the existing pure reducers (`settingsReduce`, `fileSelectReduce`) survive unchanged and are driven by a single `useKeyboard` router in `<App>`. Core logic (`git/`, `ai/`, `core/`, `demo/`) stays plain TypeScript, migrated to Bun-native process APIs. Non-TTY paths (piped `reviewGate`, piped `--dry-run`) stay plain-string prints.

**Tech Stack:** Bun (runtime + `bun test`), `@opentui/core`, `@opentui/react`, React 19, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-02-opentui-rewrite-design.md`

## Global Constraints

- Branch: all work on `opentui-rewrite`, branched from `main` after the WIP commits (Task 0).
- Runtime: Bun everywhere on the branch. No `node` invocations in scripts; no `--experimental-strip-types`.
- UI boundary: no `@opentui` imports outside `src/tui/` and its tests. No UI imports inside `src/core/`, `src/git/`, `src/ai/`, `src/demo/`.
- Key-token vocabulary (unchanged from today, consumed by the kept reducers): `"up" | "down" | "left" | "right" | "enter" | "escape" | "ctrl-c" | "backspace" | " "` plus single printable characters.
- Keybindings (identical to current app): `↑/↓/j/k` move · `enter` accept · `a` accept all · `s` skip · `q`/ctrl-c quit · `e` edit message · `E` edit body · `n` new commit · `p` instruct claude · `r` regen all · `R` regen one · `c` settings.
- Pinned model IDs stay exactly: `claude-sonnet-4-6` (default), `claude-opus-4-8`, `claude-haiku-4-5`.
- Tests: `bun test` must be green at the end of every task. Assertions keep `node:assert/strict` (works under Bun); only the `test` import changes to `bun:test`.
- **Spec amendment (agreed rationale):** `src/ui/spinner.ts` (nanospinner) survives for the *non-interactive* TTY paths only (`--apply`, `--dry-run` planning wait). The interactive app renders `<PlanningScreen>` instead. Piped output stays unstyled.
- Uncertain third-party API details (mockInput methods, ASCII-font JSX tag, key event fields) are wrapped in adapters (`test/tui-helpers.ts`, `src/tui/keys.ts`, `src/tui/banner.tsx`) and each has an explicit verify step against the installed package. If a verify step contradicts this plan's code, fix the adapter, not the callers.

---

### Task 0: Commit session WIP to main

**Files:**
- No new files. Commits existing modifications on `main`.

**Interfaces:**
- Produces: a clean `main` working tree at the branch point.

- [ ] **Step 1: Review what is dirty**

Run: `git status --short && git diff --stat`
Expected: modifications to `package.json`, `package-lock.json`, `src/ui/ansi.ts`, `src/ui/review.ts`, `src/ui/settings-pane.ts`, `src/ai/claude.ts`, `src/cli.ts`, and `test/*.test.ts` files.

- [ ] **Step 2: Verify the suite is green before committing**

Run: `npm test`
Expected: `pass 104`, `fail 0` (still on Node here).

- [ ] **Step 3: Commit the banner/styles work**

```bash
git add package.json package-lock.json src/ui/ansi.ts src/ui/review.ts src/ui/settings-pane.ts test/review-interactive.test.ts
git commit -m "feat(ui): figlet banner, gradient styling, multi-line header, centralized color handling

All useColor decisions now live in styles() in ansi.ts (paint/chip/banner
helpers); review header is a multi-line settings block; title is a
responsive figlet banner that hides on short terminals.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Commit the model pinning**

```bash
git add src/ai/claude.ts src/cli.ts test/settings-persistence.test.ts
git commit -m "feat: pin model IDs instead of floating tier aliases

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Verify clean tree**

Run: `git status --short`
Expected: empty output (untracked `docs/` files are fine if any remain — commit them with `docs:` if present).

---

### Task 1: Branch + Bun toolchain bootstrap

**Files:**
- Modify: `package.json` (scripts, deps)
- Modify: `tsconfig.json` (jsx, types)
- Modify: `index.ts` (shebang, if present)
- Modify: all 12 files in `test/*.test.ts` (import swap)

**Interfaces:**
- Produces: `bun test` runs the whole existing suite green; `@opentui/core`, `@opentui/react`, `react` installed and importable.

- [ ] **Step 1: Install Bun (not present on this machine)**

Run: `brew install oven-sh/bun/bun && bun --version`
Expected: a version number ≥ 1.2. (If brew is unavailable: `curl -fsSL https://bun.sh/install | bash` and restart the shell.)

- [ ] **Step 2: Create the branch**

Run: `git checkout -b opentui-rewrite`
Expected: `Switched to a new branch 'opentui-rewrite'`

- [ ] **Step 3: Add dependencies**

Run: `bun add @opentui/core @opentui/react react && bun add -d @types/react @types/bun`
Expected: package.json gains the deps; `bun.lock` created. Note: npm's `package-lock.json` stays for `main` compatibility until the branch lands — do not delete it.

- [ ] **Step 4: Switch scripts to Bun**

In `package.json`, replace the scripts block:

```json
"scripts": {
  "test": "bun test",
  "typecheck": "tsc --noEmit",
  "dev": "bun --watch ./index.ts",
  "demo": "bun ./index.ts --demo",
  "dev:demo": "COMMIT_DEMO_DELAY=0 bun --watch ./index.ts --demo"
}
```

- [ ] **Step 5: Update tsconfig for JSX + Bun types**

In `tsconfig.json` `compilerOptions`, add/change:

```json
"jsx": "react-jsx",
"types": ["node", "bun"]
```

- [ ] **Step 6: Update the bin entry shebang**

Read `index.ts`. If its first line is a `#!/usr/bin/env node...` shebang, change it to:

```
#!/usr/bin/env bun
```

If there is no shebang, add that line as line 1.

- [ ] **Step 7: Swap test-runner imports in all test files**

Run:
```bash
grep -rl "node:test" test/ | xargs sed -i '' "s/from 'node:test'/from 'bun:test'/; s/from \"node:test\"/from \"bun:test\"/"
grep -rn "node:test" test/
```
Expected: second command prints nothing. Assertions (`node:assert/strict`) are NOT changed — Bun supports them.

- [ ] **Step 8: Run the suite under Bun**

Run: `bun test`
Expected: 104 pass, 0 fail. If any test fails on a `node:test`-specific API (subtests, `t.mock`), rewrite just that test to plain `test()` + manual fake — do not add mocking libraries.

- [ ] **Step 9: Typecheck**

Run: `bun run typecheck`
Expected: clean. If `@types/bun` and `@types/node` conflict on globals, remove `"node"` from the `types` array (Bun's types include Node compat) and re-run.

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock tsconfig.json index.ts test/
git commit -m "build: migrate toolchain to Bun; add OpenTUI + React deps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Bun-native process APIs in core

**Files:**
- Modify: `src/git/run.ts`
- Modify: `src/ai/claude.ts:32-61` (the `runClaudeCli` function)
- Test: existing `test/execute.test.ts`, `test/call-claude.test.ts` (no new tests — behavior is unchanged and already covered)

**Interfaces:**
- Consumes: nothing new.
- Produces: `runGit(args, options?) => GitResult` and `callClaude(prompt, opts?) => Promise<string>` — signatures unchanged; internals use `Bun.spawnSync`/`Bun.spawn`.

- [ ] **Step 1: Rewrite runGit with Bun.spawnSync**

Replace the body of `src/git/run.ts`:

```ts
// The single place we shell out to git. Injected everywhere else so the rest of
// the codebase stays free of process spawning and easy to test.

import type { GitResult } from "../types.ts";

export function runGit(args: string[], options: { cwd?: string } = {}): GitResult {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: options.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}
```

- [ ] **Step 2: Run the git-touching tests**

Run: `bun test test/execute.test.ts test/status.test.ts test/collect.test.ts`
Expected: PASS (these exercise real git in temp dirs through `runGit`).

- [ ] **Step 3: Rewrite runClaudeCli with Bun.spawn**

In `src/ai/claude.ts`, remove the `execFile` import and `MAX_OUTPUT_BYTES` constant; replace `runClaudeCli`:

```ts
// runClaudeCli(prompt, model, effort) -> the process result. Speed flags:
// --strict-mcp-config (with no --mcp-config) loads ZERO MCP servers; a small
// --system-prompt + fast --model + low --effort keep latency down. (--bare is
// deliberately NOT used — it skips the settings that hold auth.)
async function runClaudeCli(
  prompt: string,
  model: string,
  effort: string,
): Promise<GitResult> {
  const args = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "json",
    "--strict-mcp-config",
    "--model",
    model,
    "--system-prompt",
    PLANNER_SYSTEM_PROMPT,
    "--effort",
    effort,
  ];
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { status, stdout, stderr };
  } catch (error) {
    return { status: 1, stdout: "", stderr: (error as Error).message };
  }
}
```

- [ ] **Step 4: Run the claude tests, then the full suite**

Run: `bun test test/call-claude.test.ts && bun test`
Expected: all green (callClaude's tests inject a fake runner; the wrapper contract is what they assert).

- [ ] **Step 5: Commit**

```bash
git add src/git/run.ts src/ai/claude.ts
git commit -m "refactor(core): Bun-native process spawning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: TUI foundation — key adapter, theme, test helper

**Files:**
- Create: `src/tui/keys.ts`
- Create: `src/tui/theme.ts`
- Create: `test/tui-helpers.ts`
- Test: `test/tui-foundation.test.ts`

**Interfaces:**
- Produces:
  - `toKey(event: { name?: string; ctrl?: boolean; sequence?: string }): string` — normalizes OpenTUI key events to the Global Constraints token vocabulary.
  - `theme` object: `{ accent: string; dim: string; model: Record<string,{fg:string;bg:string}>; effortColor: Record<string,string>; onColor: string; offColor: string }`.
  - `renderTui(node: ReactNode, opts?: {width?: number; height?: number}) => Promise<{ frame(): string; press(...keys: string[]): Promise<void>; type(text: string): Promise<void>; resize(w: number, h: number): void; destroy(): void }>` — the ONLY way TUI tests render components.

- [ ] **Step 1: Verify the installed testing + keyboard API surface**

Run:
```bash
cat node_modules/@opentui/core/src/testing/README.md 2>/dev/null || find node_modules/@opentui/core -name "*.md" -path "*test*"
grep -rn "mockInput" node_modules/@opentui/core/dist/testing.d.ts | head -20
grep -rn "name\|ctrl\|sequence" node_modules/@opentui/core/dist/*.d.ts | grep -i "keyevent" | head -20
```
Record: the exact `mockInput` method names (expected shapes: `pressKey(name)` / `typeText(text)` or similar) and the key-event field names. **Adjust Steps 3–5 below to the recorded reality** — the helper and adapter are the only files that may change.

- [ ] **Step 2: Write the failing foundation test**

`test/tui-foundation.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test test/tui-foundation.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the key adapter and theme**

`src/tui/keys.ts`:

```ts
// Normalizes OpenTUI keyboard events into the app's key-token vocabulary
// (the same tokens the pre-rewrite reducers consumed), so reducers stay pure
// and framework-free. Adjust ONLY this file if OpenTUI's event shape differs.

export interface KeyLike {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

const PASSTHROUGH = new Set(["up", "down", "left", "right", "escape", "backspace"]);

export function toKey(key: KeyLike): string {
  const name = key.name ?? "";
  if (key.ctrl && name === "c") return "ctrl-c";
  if (name === "return" || name === "enter") return "enter";
  if (name === "space") return " ";
  if (PASSTHROUGH.has(name)) return name;
  if (key.sequence && key.sequence.length === 1) return key.sequence;
  return name;
}
```

`src/tui/theme.ts`:

```ts
// Every color the TUI uses, in one place. Successor to styles() in ansi.ts.

export const theme = {
  accent: "#00FFFF",
  dim: "#777777",
  focusBg: "#FFFFFF",
  focusFg: "#000000",
  model: {
    "claude-sonnet-4-6": { fg: "#000000", bg: "#FFFF00" },
    "claude-opus-4-8": { fg: "#000000", bg: "#00FF00" },
    "claude-haiku-4-5": { fg: "#000000", bg: "#00FFFF" },
  } as Record<string, { fg: string; bg: string }>,
  effortColor: {
    low: "#5555FF",
    medium: "#FF55FF",
    high: "#FF5555",
  } as Record<string, string>,
  onColor: "#00FF00",
  offColor: "#FF0000",
};
```

- [ ] **Step 5: Implement the test helper**

`test/tui-helpers.ts` (adjust method names per Step 1 findings):

```ts
// The single adapter between tests and OpenTUI's test renderer. All TUI tests
// render through renderTui(); if @opentui's testing API drifts, fix it here.

import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import type { ReactNode } from "react";

export async function renderTui(
  node: ReactNode,
  { width = 80, height = 24 }: { width?: number; height?: number } = {},
) {
  const testCtx = await createTestRenderer({ width, height });
  const { renderer, renderOnce, captureCharFrame, mockInput, resize } = testCtx;
  const root = createRoot(renderer);
  root.render(node);
  await renderOnce();

  return {
    frame(): string {
      return captureCharFrame();
    },
    async press(...keys: string[]): Promise<void> {
      for (const key of keys) {
        mockInput.pressKey(key); // VERIFY: exact method name from Step 1
        await renderOnce();
      }
    },
    async type(text: string): Promise<void> {
      mockInput.typeText(text); // VERIFY: exact method name from Step 1
      await renderOnce();
    },
    resize(w: number, h: number): void {
      resize(w, h);
    },
    destroy(): void {
      renderer.destroy();
    },
  };
}
```

- [ ] **Step 6: Run to verify pass**

Run: `bun test test/tui-foundation.test.ts`
Expected: PASS. Iterate on the helper (not the tests) until green.

- [ ] **Step 7: Commit**

```bash
git add src/tui/keys.ts src/tui/theme.ts test/tui-helpers.ts test/tui-foundation.test.ts
git commit -m "feat(tui): key adapter, theme, and test-render helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Banner and Status components

**Files:**
- Create: `src/tui/banner.tsx`
- Create: `src/tui/status.tsx`
- Test: `test/tui-banner-status.test.ts`

**Interfaces:**
- Produces:
  - `<Banner height={number} />` and pure `shouldShowBanner(terminalHeight: number, reservedRows: number): boolean`.
  - `<Status label={string} startedAt={number} />` — renders `commit · {elapsed}s · {label}`.

- [ ] **Step 1: Verify the ASCII-font intrinsic element name**

Run: `grep -rn "ascii" node_modules/@opentui/react/dist/*.d.ts | head -10`
Record the JSX tag (expected `ascii-font` or `asciiFont`) and its props (`text`, `font`, `color`/`fg`). Adjust Step 4 accordingly.

- [ ] **Step 2: Write failing tests**

`test/tui-banner-status.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test test/tui-banner-status.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement Banner**

`src/tui/banner.tsx`:

```tsx
// The ASCII title banner. Pure size logic is exported for direct testing;
// the component hides itself when the terminal is too short (the same
// responsive behavior the figlet version had, without the arithmetic).

import { theme } from "./theme.ts";

const BANNER_ROWS = 6; // ascii font height + margin row
const TITLE = "AI-commit";

export function shouldShowBanner(terminalHeight: number, reservedRows: number): boolean {
  return terminalHeight - reservedRows >= BANNER_ROWS + 2;
}

export function Banner({ height }: { height: number }) {
  if (!shouldShowBanner(height, 12)) return null;
  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      {/* VERIFY tag name per Step 1 — expected <ascii-font> */}
      <ascii-font text={TITLE} font="tiny" fg={theme.accent} />
    </box>
  );
}
```

- [ ] **Step 5: Implement Status**

`src/tui/status.tsx`:

```tsx
// Busy line shown while a claude call runs. Replaces the nanospinner path
// inside the interactive app (spinner.ts remains only for non-interactive
// modes). Ticks elapsed seconds itself.

import { useEffect, useState } from "react";
import { theme } from "./theme.ts";

export function statusText(elapsedSeconds: number, label: string): string {
  return `commit · ${elapsedSeconds}s · ${label || "working…"}`;
}

export function Status({ label, startedAt }: { label: string; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <text fg={theme.accent}>{statusText(elapsed, label)}</text>;
}
```

- [ ] **Step 6: Run to verify pass**

Run: `bun test test/tui-banner-status.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tui/banner.tsx src/tui/status.tsx test/tui-banner-status.test.ts
git commit -m "feat(tui): Banner and Status components

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: CommitBlock and ReviewScreen (pure views)

**Files:**
- Create: `src/tui/commit-block.tsx`
- Create: `src/tui/review-screen.tsx`
- Test: `test/tui-review-screen.test.ts`

**Interfaces:**
- Consumes: `Banner` (Task 4), `theme` (Task 3), `formatCommitMessage` from `src/core/message.ts`, types from `src/types.ts`.
- Produces:
  - `<CommitBlock commit={PlannedCommit} index={number} focused={boolean} />`
  - `<ReviewScreen commits={PlannedCommit[]} cursor={number} committed={Committed[]} settings={Settings} height={number} />`
  - Exported legend strings `LEGEND_NAV`, `LEGEND_EDIT` (moved verbatim from `src/ui/review.ts:29-31`).

- [ ] **Step 1: Write failing tests**

`test/tui-review-screen.test.ts`:

```ts
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
    commits: COMMITS, cursor: 0, committed: [], settings: SETTINGS, height: 30,
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/tui-review-screen.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement CommitBlock**

`src/tui/commit-block.tsx`:

```tsx
// One commit in the review list: label row, subject (highlighted when
// focused), optional dim body lines, files row.

import { formatCommitMessage } from "../core/message.ts";
import { theme } from "./theme.ts";
import type { PlannedCommit } from "../types.ts";

export function CommitBlock({
  commit, index, focused,
}: { commit: PlannedCommit; index: number; focused: boolean }) {
  const lines = formatCommitMessage(commit).split("\n");
  const subject = lines[0];
  const body = lines.slice(1).filter((line) => line.trim() !== "");
  return (
    <box style={{ flexDirection: "column" }}>
      <text>
        <span fg={focused ? theme.accent : theme.dim}>
          {focused ? "❯ " : "  "}Commit {index + 1}
        </span>
      </text>
      <text>
        {"     "}
        {focused
          ? <span fg={theme.focusFg} bg={theme.focusBg}> {subject} </span>
          : <span> {subject} </span>}
      </text>
      {body.map((line, i) => (
        <text key={i} fg={theme.dim}>{"       " + line}</text>
      ))}
      <text fg={theme.dim}>{"     files: " + commit.files.join(", ")}</text>
    </box>
  );
}
```

- [ ] **Step 4: Implement ReviewScreen**

`src/tui/review-screen.tsx`:

```tsx
// The main picker screen: banner, settings block, committed line, commit list
// in a scrollbox (native scrolling replaces the old height-windowing math),
// footer legend.

import { Banner } from "./banner.tsx";
import { CommitBlock } from "./commit-block.tsx";
import { theme } from "./theme.ts";
import type { PlannedCommit, Committed, Settings } from "../types.ts";

export const LEGEND_NAV = "↑/↓ move · enter accept · a accept all · s skip · q quit";
export const LEGEND_EDIT =
  "n new · p ask claude · e msg · E body · r regen all · R regen one · c settings";

export function ReviewScreen({
  commits, cursor, committed, settings, height,
}: {
  commits: PlannedCommit[];
  cursor: number;
  committed: Committed[];
  settings: Settings;
  height: number;
}) {
  const modelStyle = theme.model[settings.model] ?? { fg: theme.accent, bg: "" };
  return (
    <box style={{ flexDirection: "column", height: "100%" }}>
      <Banner height={height} />
      <box style={{ flexDirection: "column" }}>
        <text fg={theme.dim}>Settings</text>
        <text><span fg={theme.dim}>Model: </span><span fg={modelStyle.fg} bg={modelStyle.bg}>{settings.model}</span></text>
        <text><span fg={theme.dim}>Effort: </span><span fg={theme.effortColor[settings.effort] ?? theme.accent}>{settings.effort}</span></text>
        <text><span fg={theme.dim}>Verbose: </span><span fg={settings.verbose ? theme.onColor : theme.offColor}>{settings.verbose ? "verbose" : "subject-only"}</span></text>
      </box>
      {committed.length > 0 && (
        <text fg={theme.dim}>
          ✓ committed {committed.length}: {committed.map((c) => c.subject).join(", ")}
        </text>
      )}
      <scrollbox style={{ flexGrow: 1 }}>
        {commits.map((commit, index) => (
          <CommitBlock key={index} commit={commit} index={index} focused={index === cursor} />
        ))}
      </scrollbox>
      <box style={{ flexDirection: "column" }}>
        <text fg={theme.dim}>{LEGEND_NAV}</text>
        <text fg={theme.dim}>{LEGEND_EDIT}</text>
      </box>
    </box>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test test/tui-review-screen.test.ts`
Expected: PASS. If the scrollbox needs the focused child scrolled into view and doesn't do it automatically, add a `scrollTop`-style prop driven by `cursor` (check `node_modules/@opentui/react/dist/*.d.ts` for the scrollbox props) — keep the fix inside ReviewScreen.

- [ ] **Step 6: Commit**

```bash
git add src/tui/commit-block.tsx src/tui/review-screen.tsx test/tui-review-screen.test.ts
git commit -m "feat(tui): CommitBlock and ReviewScreen views

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Settings screen (reducer moved, view rebuilt)

**Files:**
- Create: `src/tui/settings.ts` (logic moved from `src/ui/settings-pane.ts` — reducer, constants; NOT the render function)
- Create: `src/tui/settings-screen.tsx`
- Test: `test/tui-settings.test.ts`

**Interfaces:**
- Consumes: `theme` (Task 3).
- Produces:
  - `settingsReduce(state: SettingsPaneState, key: string): SettingsStep`, `SETTING_MODELS`, `SETTING_EFFORTS`, types `SettingsPaneState`, `SettingsStep` — **moved verbatim** from `src/ui/settings-pane.ts` (drop only the chalk import and `renderSettings`).
  - `<SettingsScreen state={SettingsPaneState} />` — pure view.

- [ ] **Step 1: Write failing tests**

`test/tui-settings.test.ts` — port the reducer test from `test/review-interactive.test.ts:236-250` with the new import path, plus a view test:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/tui-settings.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Move the logic**

Create `src/tui/settings.ts` by copying from `src/ui/settings-pane.ts`: the `SETTING_MODELS`, `SETTING_EFFORTS` constants, the `SETTING_FIELDS` array, `SettingsPaneState`, `SettingsStep`, `cycle()`, and `settingsReduce()` — unchanged. Do NOT copy `MODEL_BG`/`EFFORT_BG` (chalk-based) or `renderSettings`. Do NOT delete the old file yet (Task 10 does).

- [ ] **Step 4: Implement the view**

`src/tui/settings-screen.tsx`:

```tsx
// Pure view of the settings pane. Key handling lives in App, which routes
// tokens through settingsReduce.

import { theme } from "./theme.ts";
import type { SettingsPaneState } from "./settings.ts";

const FIELDS = ["model", "effort", "verbose"] as const;

export function SettingsScreen({ state }: { state: SettingsPaneState }) {
  const { settings, cursor } = state;
  const values: Record<(typeof FIELDS)[number], string> = {
    model: settings.model,
    effort: settings.effort,
    verbose: settings.verbose ? "on" : "off",
  };
  const badge = (field: string, value: string) => {
    if (field === "model") {
      const style = theme.model[value];
      return style ? <span fg={style.fg} bg={style.bg}> {value} </span> : <span>{value}</span>;
    }
    if (field === "effort") {
      return <span fg={theme.effortColor[value] ?? theme.accent}> {value} </span>;
    }
    return <span fg={value === "on" ? theme.onColor : theme.offColor}> {value} </span>;
  };
  return (
    <box style={{ flexDirection: "column" }}>
      <text>Settings</text>
      <text> </text>
      {FIELDS.map((field, index) => (
        <text key={field}>
          <span fg={theme.accent}>{index === cursor ? "❯ " : "  "}</span>
          {(field + ":").padEnd(9)}
          {badge(field, values[field])}
        </text>
      ))}
      <text> </text>
      <text fg={theme.dim}>↑/↓ field · ←/→ change · esc close — then r/R to regenerate</text>
    </box>
  );
}
```

- [ ] **Step 5: Run to verify pass, then commit**

Run: `bun test test/tui-settings.test.ts`
Expected: PASS.

```bash
git add src/tui/settings.ts src/tui/settings-screen.tsx test/tui-settings.test.ts
git commit -m "feat(tui): settings screen with reducer moved from old pane

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: File-select screen (reducer moved, view rebuilt)

**Files:**
- Create: `src/tui/file-select.ts` (logic moved from `src/ui/file-select.ts`)
- Create: `src/tui/file-select-screen.tsx`
- Test: `test/tui-file-select.test.ts`

**Interfaces:**
- Produces:
  - `fileSelectReduce(state: FileSelectState, key: string): FileSelectStep` + types `FileSelectItem`, `FileSelectState`, `FileSelectStep` — **moved verbatim** from `src/ui/file-select.ts` (drop the `renderFileSelect` function and ansi import).
  - `<FileSelectScreen state={FileSelectState} />` — pure view.

- [ ] **Step 1: Write failing tests**

`test/tui-file-select.test.ts` — port the reducer assertions from `test/review-interactive.test.ts:271+` (toggle/navigate/confirm/cancel) with the new import path, plus:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/tui-file-select.test.ts`
Expected: FAIL.

- [ ] **Step 3: Move the logic and implement the view**

Create `src/tui/file-select.ts`: copy `FileSelectItem`, `FileSelectState`, `FileSelectStep`, `fileSelectReduce` verbatim from `src/ui/file-select.ts` (no ansi import, no render function). Old file stays until Task 10.

`src/tui/file-select-screen.tsx`:

```tsx
// Pure view of the file multi-select used when hand-building a commit (n).

import { theme } from "./theme.ts";
import type { FileSelectState } from "./file-select.ts";

export function FileSelectScreen({ state }: { state: FileSelectState }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.accent}>Pick files for the new commit</text>
      <text> </text>
      {state.items.map((item, index) => {
        const focused = index === state.cursor;
        const row = `${item.on ? "[x]" : "[ ]"} ${item.path}`;
        return (
          <text key={item.path}>
            <span fg={theme.accent}>{focused ? "❯ " : "  "}</span>
            {focused
              ? <span fg={theme.focusFg} bg={theme.focusBg}> {row} </span>
              : <span> {row} </span>}
          </text>
        );
      })}
      <text> </text>
      <text fg={theme.dim}>↑/↓ move · space toggle · enter confirm · esc cancel</text>
    </box>
  );
}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `bun test test/tui-file-select.test.ts`
Expected: PASS.

```bash
git add src/tui/file-select.ts src/tui/file-select-screen.tsx test/tui-file-select.test.ts
git commit -m "feat(tui): file-select screen with reducer moved

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: LineEditor component

**Files:**
- Create: `src/tui/line-editor.tsx`
- Test: `test/tui-line-editor.test.ts`

**Interfaces:**
- Produces: `<LineEditor prompt={string} initial={string} onSave={(value: string) => void} onCancel={() => void} />` — single-line editor with prefill; enter saves, escape cancels. Replaces `src/ui/editor.ts`'s `readLine`.

- [ ] **Step 1: Write failing tests**

`test/tui-line-editor.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/tui-line-editor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/tui/line-editor.tsx`:

```tsx
// Modal single-line editor: prefilled input, enter saves, escape cancels.
// Body editing keeps the caller-side "\n"-escaping convention from the old
// editor (the caller converts, this component is newline-agnostic).

import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { toKey } from "./keys.ts";
import { theme } from "./theme.ts";

export function LineEditor({
  prompt, initial, onSave, onCancel,
}: {
  prompt: string;
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  useKeyboard((key) => {
    if (toKey(key) === "escape") onCancel();
  });
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.dim}>{prompt}</text>
      <input value={value} focused onInput={setValue} onSubmit={onSave} />
      <text fg={theme.dim}>enter save · esc cancel</text>
    </box>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test test/tui-line-editor.test.ts`
Expected: PASS. Known risks to fix inside this component only: (a) the `value` prop may be initial-only vs controlled — if typing doesn't append, switch to uncontrolled with `value={initial}` and read the final value from `onInput` state at submit; (b) escape may be swallowed by the focused input — if `onCancel` never fires, check the input's own key events (`onKeyDown`-style prop in the .d.ts) and handle escape there.

- [ ] **Step 5: Commit**

```bash
git add src/tui/line-editor.tsx test/tui-line-editor.test.ts
git commit -m "feat(tui): LineEditor component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: App — screen routing, navigation, commit/skip/quit

**Files:**
- Create: `src/tui/app.tsx`
- Test: `test/tui-app.test.ts`

**Interfaces:**
- Consumes: all Task 3–8 exports; `executeOne` from `src/git/commit.ts`; `formatCommitMessage` from `src/core/message.ts`.
- Produces:

```ts
export interface AppDeps {
  commitOne: (commit: PlannedCommit) => Committed;   // wraps executeOne(commit, {runGit, expandPath})
  replan: (settings: Settings, instruction?: string) => Promise<Plan | null>;
  regenerateCommit: (commit: PlannedCommit, settings: Settings) => Promise<CommitMessage | null>;
}
export interface AppResult { committed: Committed[]; settings: Settings; }
export function App(props: {
  plan: Plan;
  settings: Settings;
  deps: AppDeps;
  height: number;
  onDone: (result: AppResult) => void;
}): JSX.Element;
```

Screen state union (internal): `{ name: "review" } | { name: "settings"; pane: SettingsPaneState } | { name: "files"; state: FileSelectState } | { name: "edit"; kind: "message" | "body" | "newCommit" | "instruction"; initial: string; selectedFiles?: string[] } | { name: "regenAll" } | { name: "busy"; label: string; startedAt: number }`.

This task implements **review-screen keys only**: `up/down/j/k/enter/a/s/q/ctrl-c` + opening `c` (settings) and its full loop. Tasks 10–11 add the rest; their keys are ignored until then.

- [ ] **Step 1: Write failing tests**

`test/tui-app.test.ts`:

```ts
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
    node: React.createElement(App, { plan, settings: SETTINGS, deps, height: 30, onDone, ...overrides }),
    committedLog: committed,
  };
}

test("j/k moves the focus marker", async () => {
  const { node } = makeApp(() => {});
  const ui = await renderTui(node, { height: 30 });
  await ui.press("j");
  assert.ok(ui.frame().split("\n").find((l) => l.includes("Commit 2"))?.includes("❯"));
  await ui.press("k");
  assert.ok(ui.frame().split("\n").find((l) => l.includes("Commit 1"))?.includes("❯"));
  ui.destroy();
});

test("s skips the focused commit", async () => {
  const { node } = makeApp(() => {});
  const ui = await renderTui(node, { height: 30 });
  await ui.press("s");
  assert.doesNotMatch(ui.frame(), /add a/);
  assert.match(ui.frame(), /fix b/);
  ui.destroy();
});

test("enter commits the focused commit and shows progress", async () => {
  const { node, committedLog } = makeApp(() => {});
  const ui = await renderTui(node, { height: 30 });
  await ui.press("return");
  assert.deepEqual(committedLog, ["add a"]);
  assert.match(ui.frame(), /committed 1: add a/);
  ui.destroy();
});

test("a commits everything and resolves", async () => {
  let result: AppResult | null = null;
  const { node, committedLog } = makeApp((r) => { result = r; });
  const ui = await renderTui(node, { height: 30 });
  await ui.press("a");
  assert.deepEqual(committedLog, ["add a", "fix b"]);
  assert.equal(result!.committed.length, 2);
  ui.destroy();
});

test("q resolves with whatever was committed so far", async () => {
  let result: AppResult | null = null;
  const { node } = makeApp((r) => { result = r; });
  const ui = await renderTui(node, { height: 30 });
  await ui.press("return");
  await ui.press("q");
  assert.equal(result!.committed.length, 1);
  assert.equal(result!.settings.model, "claude-sonnet-4-6");
  ui.destroy();
});

test("c opens settings; changes flow back on close", async () => {
  let result: AppResult | null = null;
  const { node } = makeApp((r) => { result = r; });
  const ui = await renderTui(node, { height: 30 });
  await ui.press("c");
  assert.match(ui.frame(), /←\/→ change/);
  await ui.press("right");   // model -> claude-opus-4-8
  await ui.press("escape");  // close pane
  assert.match(ui.frame(), /Model: claude-opus-4-8/);
  await ui.press("q");
  assert.equal(result!.settings.model, "claude-opus-4-8");
  ui.destroy();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/tui-app.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement App (navigation slice)**

`src/tui/app.tsx`:

```tsx
// The one React root of the interactive picker. Owns all app state; a single
// useKeyboard routes normalized key tokens to the active screen's handler.
// Screens themselves are pure views.

import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { toKey } from "./keys.ts";
import { ReviewScreen } from "./review-screen.tsx";
import { SettingsScreen } from "./settings-screen.tsx";
import { FileSelectScreen } from "./file-select-screen.tsx";
import { LineEditor } from "./line-editor.tsx";
import { Status } from "./status.tsx";
import { settingsReduce, type SettingsPaneState } from "./settings.ts";
import { fileSelectReduce, type FileSelectState } from "./file-select.ts";
import type {
  Plan, PlannedCommit, CommitMessage, Committed, Settings,
} from "../types.ts";

export interface AppDeps {
  commitOne: (commit: PlannedCommit) => Committed;
  replan: (settings: Settings, instruction?: string) => Promise<Plan | null>;
  regenerateCommit: (commit: PlannedCommit, settings: Settings) => Promise<CommitMessage | null>;
}

export interface AppResult {
  committed: Committed[];
  settings: Settings;
}

type Screen =
  | { name: "review" }
  | { name: "settings"; pane: SettingsPaneState }
  | { name: "files"; state: FileSelectState }
  | { name: "edit"; kind: "message" | "body" | "newCommit" | "instruction"; initial: string; selectedFiles?: string[] }
  | { name: "regenAll" }
  | { name: "busy"; label: string; startedAt: number };

export function App({
  plan, settings: initialSettings, deps, height, onDone,
}: {
  plan: Plan;
  settings: Settings;
  deps: AppDeps;
  height: number;
  onDone: (result: AppResult) => void;
}) {
  const [commits, setCommits] = useState<PlannedCommit[]>(plan.commits);
  const [cursor, setCursor] = useState(0);
  const [committed, setCommitted] = useState<Committed[]>([]);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [screen, setScreen] = useState<Screen>({ name: "review" });

  const clampCursor = (next: PlannedCommit[]) =>
    setCursor((c) => Math.max(0, Math.min(c, next.length - 1)));

  const finish = (done: Committed[]) => onDone({ committed: done, settings });

  const commitAt = (index: number): Committed[] => {
    const record = deps.commitOne(commits[index]);
    const nextCommits = commits.filter((_, i) => i !== index);
    const nextCommitted = [...committed, record];
    setCommits(nextCommits);
    setCommitted(nextCommitted);
    clampCursor(nextCommits);
    if (nextCommits.length === 0) finish(nextCommitted);
    return nextCommitted;
  };

  const handleReviewKey = (key: string) => {
    const count = commits.length;
    if (key === "up" || key === "k") setCursor((c) => (c - 1 + count) % count);
    else if (key === "down" || key === "j") setCursor((c) => (c + 1) % count);
    else if (key === "q" || key === "ctrl-c") finish(committed);
    else if (key === "s") {
      const next = commits.filter((_, i) => i !== cursor);
      setCommits(next);
      clampCursor(next);
      if (next.length === 0) finish(committed);
    } else if (key === "enter") commitAt(cursor);
    else if (key === "a") {
      // Commit all synchronously in list order.
      let done = [...committed];
      for (const commit of commits) done = [...done, deps.commitOne(commit)];
      setCommits([]);
      setCommitted(done);
      finish(done);
    } else if (key === "c") {
      setScreen({ name: "settings", pane: { settings, cursor: 0 } });
    }
    // e/E/n/p/r/R are added in Tasks 10–11.
  };

  const handleSettingsKey = (key: string, pane: SettingsPaneState) => {
    const step = settingsReduce(pane, key);
    if ("done" in step) {
      setSettings(pane.settings);
      setScreen({ name: "review" });
    } else {
      setScreen({ name: "settings", pane: step.state });
    }
  };

  useKeyboard((event) => {
    const key = toKey(event);
    if (screen.name === "review") handleReviewKey(key);
    else if (screen.name === "settings") handleSettingsKey(key, screen.pane);
    // files / edit / regenAll / busy handlers arrive in Tasks 10–11.
  });

  if (screen.name === "settings") return <SettingsScreen state={screen.pane} />;
  if (screen.name === "files") return <FileSelectScreen state={screen.state} />;
  if (screen.name === "busy") return <Status label={screen.label} startedAt={screen.startedAt} />;
  if (screen.name === "edit") {
    return <LineEditor prompt="" initial={screen.initial} onSave={() => {}} onCancel={() => setScreen({ name: "review" })} />;
  }
  return (
    <ReviewScreen
      commits={commits} cursor={cursor} committed={committed}
      settings={settings} height={height}
    />
  );
}
```

Note the settings-close subtlety: `settingsReduce`'s done step returns without state, so the *pane's* latest settings are what we adopt — mirror the old `runSettingsPane` which used `paneState.settings`. The pane state passed to `handleSettingsKey` is the current one, so `setSettings(pane.settings)` is correct.

- [ ] **Step 4: Run to verify pass**

Run: `bun test test/tui-app.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `bun test`
Expected: all green.

```bash
git add src/tui/app.tsx test/tui-app.test.ts
git commit -m "feat(tui): App shell with navigation, commit, skip, quit, settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: App — editing flows (e, E, n)

**Files:**
- Modify: `src/tui/app.tsx`
- Test: `test/tui-app-edit.test.ts`

**Interfaces:**
- Consumes: `formatCommitMessage` from `src/core/message.ts`.
- Produces: `e` (edit header line), `E` (edit body with `\n` escaping), `n` (file-select → message editor → new commit at top) — behavior identical to `src/ui/review.ts:276-298` and `addOwnCommit` (`src/ui/review.ts:334-373`).

- [ ] **Step 1: Write failing tests**

`test/tui-app-edit.test.ts` (reuse the `makeApp` helper shape from Task 9's test file — copy it in; tests must be independently runnable):

```ts
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
  return React.createElement(App, { plan, settings: SETTINGS, deps, height: 30, onDone });
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/tui-app-edit.test.ts`
Expected: FAIL (keys ignored, screens never open).

- [ ] **Step 3: Implement the flows in app.tsx**

Add to `handleReviewKey`:

```tsx
else if (key === "e") {
  const current = formatCommitMessage(commits[cursor]).split("\n")[0];
  setScreen({ name: "edit", kind: "message", initial: current });
} else if (key === "E") {
  const current = (commits[cursor].body || "").replace(/\n/g, "\\n");
  setScreen({ name: "edit", kind: "body", initial: current });
} else if (key === "n") {
  const focusedFiles = new Set(commits[cursor]?.files ?? []);
  const allFiles = commits.flatMap((commit) => commit.files);
  setScreen({
    name: "files",
    state: { items: allFiles.map((path) => ({ path, on: focusedFiles.has(path) })), cursor: 0 },
  });
}
```

Add a files handler in the keyboard router:

```tsx
const handleFilesKey = (key: string, state: FileSelectState) => {
  const step = fileSelectReduce(state, key);
  if (!("done" in step)) { setScreen({ name: "files", state: step.state }); return; }
  if ("cancelled" in step || step.selected.length === 0) { setScreen({ name: "review" }); return; }
  const seed = commits[cursor] ? formatCommitMessage(commits[cursor]).split("\n")[0] : "";
  setScreen({ name: "edit", kind: "newCommit", initial: seed, selectedFiles: step.selected });
};
```

Replace the placeholder `edit` render with real save wiring:

```tsx
if (screen.name === "edit") {
  const prompts: Record<string, string> = {
    message: "  edit message (enter save · esc cancel): ",
    body: "  edit body — \\n for line break (enter save · esc cancel): ",
    newCommit: "  message for the new commit (enter save · esc cancel): ",
    instruction: "  tell Claude what to change (enter · esc cancel): ",
  };
  const save = (value: string) => {
    const { kind, selectedFiles } = screen;
    if (kind === "message" && value.trim()) {
      setCommits(commits.map((c, i) => (i === cursor ? { ...c, header: value.trim() } : c)));
    } else if (kind === "body") {
      const body = value.replace(/\\n/g, "\n").trim();
      setCommits(commits.map((c, i) => (i === cursor ? { ...c, body: body || undefined } : c)));
    } else if (kind === "newCommit" && value.trim() && selectedFiles) {
      const chosen = new Set(selectedFiles);
      const rest = commits
        .map((c) => ({ ...c, files: c.files.filter((f) => !chosen.has(f)) }))
        .filter((c) => c.files.length > 0);
      setCommits([{ files: selectedFiles, header: value.trim() }, ...rest]);
      setCursor(0);
    } else if (kind === "instruction") {
      runReplanWithInstruction(value); // Task 11 — no-op until then
    }
    setScreen({ name: "review" });
  };
  return (
    <LineEditor
      prompt={prompts[screen.kind]}
      initial={screen.initial}
      onSave={save}
      onCancel={() => setScreen({ name: "review" })}
    />
  );
}
```

Add `handleFilesKey` to the `useKeyboard` router (`else if (screen.name === "files") handleFilesKey(key, screen.state)`). While an `edit` screen is active the router must NOT run review handlers — the LineEditor's focused input consumes character keys; the router only forwards `escape` there (already handled inside LineEditor). Guard: `if (screen.name === "edit") return;` at the top of the router.

- [ ] **Step 4: Run to verify pass, then full suite, then commit**

Run: `bun test test/tui-app-edit.test.ts && bun test`
Expected: PASS / all green.

```bash
git add src/tui/app.tsx test/tui-app-edit.test.ts
git commit -m "feat(tui): edit message/body and hand-built commits (e, E, n)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: App — async claude flows (p, r, R, busy)

**Files:**
- Modify: `src/tui/app.tsx`
- Test: `test/tui-app-async.test.ts`

**Interfaces:**
- Produces: `p` (instruction → `deps.replan`), `R` (regen focused via `deps.regenerateCommit`), `r` (chooser: `g` regroup via replan / `m` messages-only loop / esc), busy screen during calls — behavior identical to `src/ui/review.ts:305-321` and `regenerateAll` (`:412-439`). Regenerated messages keep files, drop header overrides (`applyMessage`, `src/ui/review.ts:261-263`).

- [ ] **Step 1: Write failing tests**

`test/tui-app-async.test.ts`:

```ts
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
    plan: PLAN, settings: SETTINGS, deps: { ...base, ...deps }, height: 30, onDone,
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/tui-app-async.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in app.tsx**

Add the async helpers inside `App`:

```tsx
const busy = (label: string) => setScreen({ name: "busy", label, startedAt: Date.now() });

// Replace a commit's message but keep its files (regeneration drops any
// header override) — mirrors applyMessage in the old loop.
const applyMessage = (index: number, message: CommitMessage | null) => {
  if (!message) return;
  setCommits((current) =>
    current.map((c, i) => (i === index ? { ...message, files: c.files } : c)),
  );
};

const runRegenerateOne = async () => {
  busy("regenerating this commit");
  const message = await deps.regenerateCommit(commits[cursor], settings);
  applyMessage(cursor, message);
  setScreen({ name: "review" });
};

const runReplanWithInstruction = async (instruction: string) => {
  if (!instruction.trim()) return;
  busy("re-planning with your guidance");
  const next = await deps.replan(settings, instruction.trim());
  if (next && next.commits.length) { setCommits(next.commits); setCursor(0); }
  setScreen({ name: "review" });
};

const runRegroup = async () => {
  busy("regenerating (regrouping)");
  const next = await deps.replan(settings);
  if (next && next.commits.length) { setCommits(next.commits); setCursor(0); }
  setScreen({ name: "review" });
};

const runRewriteAll = async () => {
  for (let index = 0; index < commits.length; index++) {
    busy(`regenerating message ${index + 1}/${commits.length}`);
    applyMessage(index, await deps.regenerateCommit(commits[index], settings));
  }
  setScreen({ name: "review" });
};
```

**Stale-closure warning for `runRewriteAll`:** `commits` in the loop is the closure value at keypress time; `applyMessage` uses the functional-updater form precisely so each iteration merges into the *latest* state. Pass the closure's `commits[index]` to `regenerateCommit` (same as the old loop did) but never write `setCommits(commits.map(...))` inside async code — always the updater form.

Wire the keys in `handleReviewKey`:

```tsx
else if (key === "p") setScreen({ name: "edit", kind: "instruction", initial: "" });
else if (key === "R") void runRegenerateOne();
else if (key === "r") setScreen({ name: "regenAll" });
```

Add the chooser handler to the router:

```tsx
else if (screen.name === "regenAll") {
  if (key === "g") void runRegroup();
  else if (key === "m") void runRewriteAll();
  else if (key === "escape") setScreen({ name: "review" });
}
else if (screen.name === "busy") { /* ignore keys while busy */ }
```

And its render:

```tsx
if (screen.name === "regenAll") {
  return <text>  regenerate all — [g] regroup · [m] messages only · esc cancel</text>;
}
```

Error handling: wrap each `run*` body in `try { ... } catch (error) { setError((error as Error).message); setScreen({ name: "review" }); }` with a `const [error, setError] = useState<string | null>(null)` rendered as a red `<text>` line above the ReviewScreen footer inside the review render branch; clear it (`setError(null)`) at the start of every `run*`.

- [ ] **Step 4: Run to verify pass, then full suite, then commit**

Run: `bun test test/tui-app-async.test.ts && bun test`
Expected: PASS / all green.

```bash
git add src/tui/app.tsx test/tui-app-async.test.ts
git commit -m "feat(tui): async claude flows — instruct, regen one, regen all

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: runTui entry, PlanningScreen, and wiring main()

**Files:**
- Create: `src/tui/run.tsx`
- Create: `src/tui/planning-screen.tsx`
- Modify: `src/commands/commit.ts` (the interactive branch of `commitPlan`, `Deps`, and `planCommits` split)
- Test: `test/tui-run.test.ts` + existing `test/cli.test.ts` must stay green

**Interfaces:**
- Consumes: `App`, `AppDeps`, `AppResult` (Tasks 9–11); `Status` (Task 4); `executeOne` from `src/git/commit.ts`.
- Produces:

```ts
// src/tui/run.tsx
export interface RunTuiOptions {
  planPromise: Promise<Plan>;        // app mounts immediately; PlanningScreen until resolved
  settings: Settings;
  deps: AppDeps;
  makeRenderer?: () => Promise<TestOrCliRenderer>;  // injectable for tests
}
export function runTui(options: RunTuiOptions): Promise<AppResult>;
```

- [ ] **Step 1: Write failing tests**

`test/tui-run.test.ts`:

```ts
import { test } from "bun:test";
import assert from "node:assert/strict";
import { createTestRenderer } from "@opentui/core/testing";
import { runTui } from "../src/tui/run.tsx";

test("runTui shows planning, then review, and resolves on quit", async () => {
  const testCtx = await createTestRenderer({ width: 80, height: 24 });
  let resolvePlan!: (plan: unknown) => void;
  const planPromise = new Promise((r) => { resolvePlan = r; });

  const resultPromise = runTui({
    planPromise: planPromise as Promise<never>,
    settings: { model: "claude-sonnet-4-6", effort: "low", verbose: false },
    deps: {
      commitOne: (c) => ({ subject: c.subject ?? "", files: c.files }),
      replan: async () => null,
      regenerateCommit: async () => null,
    },
    makeRenderer: async () => testCtx.renderer,
  });

  await testCtx.renderOnce();
  assert.match(testCtx.captureCharFrame(), /planning commits/);

  resolvePlan({ commits: [{ files: ["a.ts"], type: "feat", subject: "add a" }] });
  await new Promise((r) => setTimeout(r, 10));
  await testCtx.renderOnce();
  assert.match(testCtx.captureCharFrame(), /add a/);

  testCtx.mockInput.pressKey("q"); // VERIFY method name per Task 3 findings
  const result = await resultPromise;
  assert.deepEqual(result.committed, []);
  testCtx.renderer.destroy();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/tui-run.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement PlanningScreen and runTui**

`src/tui/planning-screen.tsx`:

```tsx
// Shown while the model plans commits — the interactive replacement for the
// nanospinner status line.

import { useState } from "react";
import { Status } from "./status.tsx";

export function PlanningScreen() {
  const [startedAt] = useState(Date.now());
  return <Status label="planning commits" startedAt={startedAt} />;
}
```

`src/tui/run.tsx`:

```tsx
// Mounts the one React root for an interactive run and resolves with the
// review result. Production uses a real CLI renderer; tests inject one.

import { useEffect, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions } from "@opentui/react";
import { App, type AppDeps, type AppResult } from "./app.tsx";
import { PlanningScreen } from "./planning-screen.tsx";
import type { Plan, Settings } from "../types.ts";

export interface RunTuiOptions {
  planPromise: Promise<Plan>;
  settings: Settings;
  deps: AppDeps;
  makeRenderer?: () => Promise<{ destroy(): void }>;
}

function Root({
  planPromise, settings, deps, onDone,
}: {
  planPromise: Promise<Plan>;
  settings: Settings;
  deps: AppDeps;
  onDone: (result: AppResult | { error: Error }) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const { height } = useTerminalDimensions();
  useEffect(() => {
    planPromise.then(setPlan, (error: Error) => onDone({ error }));
  }, []);
  if (!plan) return <PlanningScreen />;
  if (plan.commits.length === 0) { onDone({ committed: [], settings }); return null; }
  return <App plan={plan} settings={settings} deps={deps} height={height} onDone={onDone} />;
}

export async function runTui({
  planPromise, settings, deps, makeRenderer,
}: RunTuiOptions): Promise<AppResult> {
  const renderer = await (makeRenderer ? makeRenderer() : createCliRenderer());
  const root = createRoot(renderer as never);
  return new Promise<AppResult>((resolve, reject) => {
    const done = (result: AppResult | { error: Error }) => {
      root.unmount?.();
      if (!makeRenderer) (renderer as { destroy(): void }).destroy();
      if ("error" in result) reject(result.error);
      else resolve(result);
    };
    root.render(
      <Root planPromise={planPromise} settings={settings} deps={deps} onDone={done} />,
    );
  });
}
```

(If `useTerminalDimensions` isn't exported by `@opentui/react`, check the .d.ts for the actual hook — `useRenderer()` exposes `renderer.height` as a fallback; keep the fix inside this file.)

- [ ] **Step 4: Wire main() — replace the interactive branch**

In `src/commands/commit.ts`:

1. Delete the imports of `interactiveReview`, `makeRawKeyDriver`, `KeyDriver`, `withStatus` usage *for the interactive path only* (keep `withStatus` for the non-interactive planning wait), and remove `nextKey`/`readLine` from `Deps`.
2. Restructure the TTY decision to happen *before* planning, so the interactive path can show `<PlanningScreen>` while planning runs:

```ts
const interactive = !args.apply && !args.dryRun && process.stdin.isTTY && deps.input === undefined;

if (interactive) {
  const planPromise = (async () => {
    const planned = await planCommitsData(pipeline); // planCommits minus the spinner — see below
    if (!planned) throw new NothingToCommit();
    plannedRef = planned; // captured for expandPath after runTui resolves
    return planned.plan;
  })();
  const result = await runTui({
    planPromise,
    settings,
    deps: {
      commitOne: (commit) =>
        executeOne(commit, { runGit: git, expandPath: plannedRef?.expandPath }),
      replan: pipeline.replan,
      regenerateCommit: pipeline.regenerateCommit,
    },
  });
  const persist = deps.saveSettings ?? saveSettings;
  persist(result.settings);
  // ... same committed-count reporting as today
}
```

Concretely: split the current `planCommits` into `planCommitsData(pipeline)` (pure of any status UI — no `withStatus`, no timing readout) and keep a thin `planCommits` wrapper that adds `withStatus` + the timing line for the **non-interactive** paths (`--apply`, `--dry-run`, piped). `NothingToCommit` is a small local error class; catch it around `runTui` to print `nothing to commit (tracked changes only)` and return 0. `executeOne` is imported from `src/git/commit.ts` (it already exists — the old loop used it).

3. The non-TTY line-gate branch and `--apply`/`--dry-run` branches stay byte-identical.

- [ ] **Step 5: Run the new test, the CLI tests, and the full suite**

Run: `bun test test/tui-run.test.ts test/cli.test.ts && bun test`
Expected: green. `test/review-interactive.test.ts` will now fail to import removed `Deps` fields only if it references `nextKey` — if so, those specific `main()`-driving tests are superseded: delete just those tests (the interactive loop they exercised is gone; Tasks 9–11 cover the replacement). Reducer tests in that file were already moved in Tasks 6–7 — delete the duplicates.

- [ ] **Step 6: Manual smoke test**

Run: `COMMIT_DEMO_DELAY=1000 bun ./index.ts --demo`
Expected: planning status appears for ~1s, then the picker; `j`/`k` move; `c` opens settings; `q` quits cleanly with the terminal restored.

- [ ] **Step 7: Commit**

```bash
git add src/tui/run.tsx src/tui/planning-screen.tsx src/commands/commit.ts test/tui-run.test.ts test/review-interactive.test.ts
git commit -m "feat(tui): mount the React app from main(); planning becomes a screen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Delete the old UI layer and drop dead dependencies

**Files:**
- Delete: `src/ui/ansi.ts`, `src/ui/raw-input.ts`, `src/ui/keys.ts`, `src/ui/editor.ts`, `src/ui/settings-pane.ts`, `src/ui/file-select.ts`
- Create: `src/review-gate.ts` (move `renderPlan` + `reviewGate` out of `src/ui/review.ts`)
- Delete: `src/ui/review.ts` (after the move)
- Keep: `src/ui/spinner.ts` (non-interactive paths — spec amendment)
- Modify: `src/commands/commit.ts` (import path), `package.json` (deps)
- Test: existing `test/review.test.ts` (import path update); delete `test/review-interactive.test.ts` remains

**Interfaces:**
- Produces: `renderPlan(plan): string` and `reviewGate(plan, opts): Promise<Plan | null>` from `src/review-gate.ts`, signatures unchanged.

- [ ] **Step 1: Move the non-TTY gate**

Create `src/review-gate.ts` containing `renderPlan` and `reviewGate` copied from `src/ui/review.ts:34-82` plus their imports (`formatCommitMessage`, types). No ansi/chalk imports — they were already plain text.

- [ ] **Step 2: Update importers**

In `src/commands/commit.ts`: `import { renderPlan, reviewGate } from "../review-gate.ts";`
In `test/review.test.ts`: update the import path to `../src/review-gate.ts`.

- [ ] **Step 3: Delete the old files**

```bash
git rm src/ui/ansi.ts src/ui/raw-input.ts src/ui/keys.ts src/ui/editor.ts src/ui/settings-pane.ts src/ui/file-select.ts src/ui/review.ts
git rm test/review-interactive.test.ts
```
(`test/review-interactive.test.ts` is fully superseded: reducers moved in Tasks 6–7, loop behavior covered by Tasks 9–11, executeOne tests live in `test/execute.test.ts`. Before deleting, grep it for any test not covered by the new suite — port stragglers into the matching `test/tui-*.test.ts` file first.)

- [ ] **Step 4: Drop dead dependencies**

Run: `bun remove figlet gradient-string chalk`
Then: `grep -rn "figlet\|gradient-string\|chalk" src/ test/` — expected: no hits. (nanospinner stays — spinner.ts survives.)

- [ ] **Step 5: Full suite + typecheck**

Run: `bun test && bun run typecheck`
Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete hand-rolled terminal UI; move non-TTY gate to review-gate.ts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: End-to-end verification and docs

**Files:**
- Modify: `src/cli.ts` (HELP text if it references node), `README.md` (run instructions, if present)

**Interfaces:** none — verification task.

- [ ] **Step 1: Demo scenarios end-to-end**

Run each and exercise the listed keys manually:
- `bun ./index.ts --demo` — j/k navigation, enter (commit one), a (commit rest), verify exit summary lists the commits.
- `bun ./index.ts --demo` — c settings: cycle model/effort/verbose, esc, then R (regen shows busy then new message).
- `bun ./index.ts --demo` — e edit header, E edit body, n new commit from files, p instruction replan, r→g regroup, r→m rewrite all, q quit.
- `bun ./index.ts --demo list` — prints scenario list, exits 0 (no TUI).

- [ ] **Step 2: Non-TTY paths unchanged**

Run: `bun ./index.ts --demo --dry-run | cat` and `printf 'q\n' | bun ./index.ts --demo`
Expected: plain-text plan + git commands for the first; line-based gate prompt then `aborted — nothing committed` for the second. No ANSI escapes in either (`| cat` output clean).

- [ ] **Step 3: Resize + short terminal behavior**

In a real terminal run `bun ./index.ts --demo`, shrink the window below ~14 rows: banner disappears, footer stays visible; grow it back: banner returns.

- [ ] **Step 4: Update docs**

- `README.md` (if present): swap any `npm test` / `node` invocations for `bun test` / `bun`, note the Bun requirement, note the branch.
- `src/cli.ts` HELP: verify nothing references Node/npm (current text doesn't; confirm).

- [ ] **Step 5: Final full suite + commit**

Run: `bun test && bun run typecheck`
Expected: green.

```bash
git add -A
git commit -m "docs: Bun-era run instructions; end-to-end demo verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** toolchain (Task 1), Bun-native core (Task 2), component tree (Tasks 3–8, 12), reducers kept (6–7), planning-as-screen (12), deletion list (13), test tiers (each task + 13), demo/non-TTY parity (12, 14), improvements — scrollbox (5), responsive banner (4), ASCII font replacing figlet (4). Spinner.ts deletion is amended (kept for non-interactive paths) — flagged in Global Constraints and Task 13.
- **Type consistency:** `AppDeps`/`AppResult` defined in Task 9, consumed in 12; `SettingsPaneState`/`FileSelectState` re-exported from moved modules (6–7); `toKey`/`renderTui` defined in 3, used from 4 on.
- **Known-unknowns:** mockInput method names (Task 3 Step 1), ascii-font tag (Task 4 Step 1), input controlled-value semantics (Task 8 Step 4), scrollbox follow-cursor (Task 5 Step 5), `useTerminalDimensions` export (Task 12 Step 3) — each pinned to a verify step and confined to one file.
