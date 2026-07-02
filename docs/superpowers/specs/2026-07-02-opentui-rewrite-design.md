# OpenTUI Rewrite — Design

**Date:** 2026-07-02
**Status:** Approved (pending user review of this document)
**Branch:** `opentui-rewrite`

## Summary

Rewrite the gitcommit-ai terminal UI using OpenTUI with its React bindings, on a
dedicated branch. The layering rule, decided explicitly:

- **Everything drawn to a TTY is a React component** (`@opentui/react`) — the
  picker screens, the planning spinner, status/error lines, the `--dry-run`
  plan display, the ASCII banner. One React root; every visual state lives
  inside it. No imperative `@opentui/core` rendering calls outside the tree.
- **Core logic is plain TypeScript** — `git/`, `ai/`, `core/`, `config.ts`,
  demo fixtures. No UI imports. Migrated to Bun-native process APIs.
- **Non-TTY output is not UI.** When stdout is a pipe (scripted `reviewGate`,
  piped `--dry-run`), no renderer can mount; those paths print plain strings,
  as today.

OpenTUI was chosen over Ink with the trade-offs understood: OpenTUI is younger
and currently Bun-exclusive, so the branch migrates the toolchain to Bun in
full. Ink remains the fallback if OpenTUI's maturity becomes a problem in
practice.

## Decisions log

| Decision | Choice |
|---|---|
| Framework | OpenTUI (`@opentui/core` + `@opentui/react`), not Ink |
| Runtime | Full Bun migration on the branch (runtime, scripts, `bun test`) |
| Git state | Commit current session's WIP to `main` first; branch from that |
| Parity | Port + improvements (native scrolling, mouse wheel, built-in ASCII fonts) |
| Architecture | Idiomatic React; existing pure reducers kept and plugged into `useReducer` |
| UI boundary | All TTY output through React; core logic has zero UI imports |

## Toolchain

- **Runtime:** Bun. Runs TypeScript + TSX natively; `--experimental-strip-types`
  goes away. `package.json` scripts switch from `node` to `bun`.
- **Tests:** `bun test`. Import swap `node:test` → `bun:test`;
  `node:assert/strict` assertions work under Bun and stay.
- **Dependencies added:** `@opentui/core`, `@opentui/react`, `react`.
- **Dependencies removed:** `figlet`, `gradient-string`, `chalk` — replaced by
  OpenTUI's `ASCIIFont`, styled-text spans, and theme colors.
- **tsconfig:** add `"jsx": "react-jsx"`.

## What is deleted

Every file that exists only because the app had no UI framework:

| File | Replaced by |
|---|---|
| `src/ui/ansi.ts` (styles, clampToWidth) | OpenTUI styled text + flexbox truncation |
| `src/ui/raw-input.ts`, `src/ui/keys.ts` | OpenTUI keyboard handling |
| `src/ui/editor.ts` | OpenTUI input component |
| `src/ui/spinner.ts` | `<Status>` component |
| `src/ui/review.ts` render + loop halves | React components (list below) |
| Height-windowing math, `↑ N more` hints | `<scrollbox>` |
| Manual `\x1b[H\x1b[J` redraw cycle | OpenTUI renderer |

`reviewGate` and `renderPlan` (the non-TTY line-based path) survive, moved out
of `src/ui/` since they are not UI — plain-text I/O for pipes.

## What is kept (and how it changes)

- `src/core/`, `src/git/`, `src/ai/`, `src/config.ts`, `src/demo/`,
  `src/cli.ts` arg parsing: logic unchanged.
- **Bun-native migration inside core:** `execFile` in `ai/claude.ts` and
  `spawnSync` in `git/run.ts` move to `Bun.spawn` / `Bun.spawnSync`.
- `settingsReduce` and `fileSelectReduce` are already `(state, key) → state`
  pure functions; they move next to their new components and plug into
  `useReducer` unchanged.
- `commands/commit.ts` orchestration is adapted: instead of running a spinner
  and then entering an imperative review loop, it mounts `<App>` once and
  passes dependencies as props.

## Component tree (`src/tui/`)

```
app.tsx                — top-level state (commits, cursor, committed, settings,
                         busy) + screen routing:
                         planning | review | settings | files | edit
banner.tsx             — ASCIIFont title; hidden when terminal height is short
review-screen.tsx      — header, commit list in <scrollbox>, footer legend
commit-block.tsx       — one commit: label, subject, body lines, files row
settings-screen.tsx    — thin component over settingsReduce
file-select-screen.tsx — thin component over fileSelectReduce
line-editor.tsx        — inline single-line editor (OpenTUI input)
status.tsx             — busy/spinner line during claude calls
theme.ts               — colors in one place (successor to styles())
```

## State & data flow

- `<App>` props: `plan`, initial `settings`, and a `deps` object
  (`replan`, `regenerateCommit`, `runGit`, `expandPath`). Same dependency-
  injection shape as today — this is what keeps `--demo` working: demo mode
  injects fakes, real mode injects real implementations.
- App-level state: `commits[]`, `cursor`, `committed[]`, `settings`, `screen`,
  `busy`.
- The planning phase becomes a screen: the app mounts immediately showing
  `<Planning>` (spinner), transitions to review when the plan resolves —
  replacing the current separate pre-picker spinner code path.
- Async claude calls set `busy` (renders `<Status>`), update `commits` on
  resolve. Errors surface as a status-line message, as today.
- Commit execution (`enter` / `a`) calls `executeOne` from core and appends to
  `committed`.

## Input

- OpenTUI keyboard hook; one handler per screen.
- Keybindings identical to today: `↑/↓/j/k` move, `enter` accept, `a` accept
  all, `s` skip, `q`/ctrl-c quit, `e` edit message, `E` edit body, `n` new
  commit, `p` instruct claude, `r` regen all, `R` regen one, `c` settings.
- Improvements taken: native scrolling via `<scrollbox>` (mouse wheel free),
  responsive banner via terminal-dimension hook.

## Error handling

- Claude CLI failure → status-line message inside the app; the app keeps
  running (as today).
- Render-tree crash → clean unmount, error to stderr, non-zero exit.
- Quit → unmount; OpenTUI restores the terminal (alternate screen cleanup).

## Testing (`bun test`)

| Tier | Strategy |
|---|---|
| Core tests (git, ai, plan, message, cli, config) | Port: import swap to `bun:test`, assertions unchanged |
| Reducer tests (settings, file-select) | Port verbatim, same import swap |
| UI tests | Rewrite against `createTestRenderer` from `@opentui/core/testing`: `mockInput` injects keys, `captureCharFrame()` asserts frame text — same assertion style as the current suite, so test intent transfers |
| Non-TTY gate tests | Unchanged |

Success criterion: feature parity with the current app (all flows, demo mode,
non-TTY path) with the improvements noted above; test suite green under
`bun test`.

## Migration order (high level — implementation plan will detail)

1. Commit session WIP to `main`; create `opentui-rewrite` branch.
2. Bun toolchain: scripts, deps, tsconfig; core tests green under `bun test`
   before any UI work.
3. Bun-native core migration (`Bun.spawn`), tests still green.
4. Component tree bottom-up: theme → banner/status → screens → app routing.
5. Wire `commands/commit.ts` to mount `<App>`; delete replaced `src/ui/` files.
6. Port/rewrite UI tests; full suite green; demo scenarios verified manually.

## Risks

- **OpenTUI maturity:** the library self-describes as in development; API churn
  is possible. Mitigation: the reducers and core are framework-free, so a
  fallback to Ink would only re-touch the thin component layer.
- **Bun/Node drift:** `main` stays on Node while the branch is on Bun; core
  changes must be merged carefully across the runtime boundary until the
  branch lands or dies.
- **`bun test` compatibility:** most `node:assert` usage works under Bun, but
  any test relying on `node:test`-specific behaviors (subtests, mocks) needs
  rework; discovered during step 2, not later.
