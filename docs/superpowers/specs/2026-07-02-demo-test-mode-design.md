# Demo / test mode design

## Problem

Iterating on the interactive UI (review pane, settings pane, file-select,
editor, spinner) currently requires a real run: real uncommitted changes, a
real `claude` CLI call (slow, ~5–17s, burns tokens), and real git mutations.
This makes UI development slow and wasteful.

We want a `--demo` flag that runs the *actual* UI against canned fixtures with
no tokens, no real git, and near-instant latency, so the UI can be exercised
anywhere and repeatedly.

## Key insight

`main()` in `src/commands/commit.ts` already accepts fully injectable effects
via its `Deps` interface: `collect`, `callClaude`, `runGit`, `replan`,
`regenerateCommit`, `loadSettings`, `saveSettings`. Demo mode is therefore not
a new code path through the UI — it is just a set of *fake* implementations of
those effects wired in behind a flag. The production UI modules
(`interactiveReview`, `settings-pane`, `file-select`, `editor`, `spinner`) run
completely unchanged. We are testing the real UI, not a mock of it.

## Scope

- Full interactive UI coverage: review pane + settings pane (`c`) + regenerate
  all/one (`r`/`R`) + ask-claude (`p`) + message/body editor (`e`/`E`) + new
  commit (`n`) + accept/skip/quit — every keybinding works against fakes.
- Canned fixtures only (no real-diff mode). Works in any directory, even a
  clean repo, fully deterministic.
- Several fixture scenarios to stress layout edge cases.

Out of scope: a real-diff variant, recording/replaying real runs, snapshot
testing of rendered frames.

## Components

### `src/demo/fixtures.ts`

Exports named scenarios. Each scenario is a plain data object:

```ts
interface DemoScenario {
  collected: Collected;        // diff, files, log
  plan: Plan;                  // the initial planned commits
  regen: CommitMessage;        // what "regenerate one" (R) returns
}

export const SCENARIOS: Record<string, DemoScenario>;
export const DEFAULT_SCENARIO = "default";
```

Scenarios:

- `default` — a realistic 3-commit plan (the common case).
- `single` — one commit.
- `many` — ~8 commits, to test list scrolling / height clamping.
- `renames` — includes files with `R` status (and matching `from`), to test
  rename handling and path display.
- `long` — long multi-line bodies and long subjects, to test wrapping /
  `clampToWidth` behaviour.

`collected.files` in each scenario must be consistent with the paths referenced
by `plan.commits[].files`, so the real `parsePlan` reconciliation succeeds.

### `src/demo/index.ts`

```ts
export function demoDeps(scenario?: string): Deps;
export function listScenarios(): string;   // human-readable names for `--demo list`
```

`demoDeps(name)` looks up the scenario (falling back to `DEFAULT_SCENARIO`, and
throwing a clear error for an unknown name) and returns fakes:

- `collect` → returns the scenario's `Collected`.
- `callClaude` → returns the scenario `plan` serialised as the JSON shape the
  planner prompt asks for, so the real `parsePlan` pipeline still runs. (This
  deliberately exercises `parsePlan` rather than bypassing it.)
- `replan` → returns a lightly varied `Plan` (e.g. tweak a subject / reorder)
  so `r`, `p`, and settings-triggered replans visibly change something.
- `regenerateCommit` → returns a varied `CommitMessage` derived from `regen`
  so `R` visibly changes the focused commit.
- `runGit` → a fake `RunGit` that returns a success `GitResult`
  (`{ status: 0, stdout: "", stderr: "" }`) for `commit` invocations, so
  accepting the plan is a safe no-op that can be run anywhere, repeatedly.
- `loadSettings` / `saveSettings` → in-memory (a closure-held object), so demo
  runs never read or write the real `~/.config/gitcommit-ai/settings.json`.

### Fake latency

The async fakes (`callClaude`, `replan`, `regenerateCommit`) await a small
delay before returning — default ~350ms, overridable via
`COMMIT_DEMO_DELAY` (milliseconds; `0` disables). This makes the "planning
commits" spinner actually visible instead of flashing, while staying ~50×
faster than a real call.

### Flag wiring — `src/cli.ts`

Extend `ParsedArgs`:

```ts
demo: boolean;          // --demo present
demoScenario: string;   // scenario name (default "default"); "list" handled specially
```

Parsing: `--demo` alone → `demo: true, demoScenario: "default"`. `--demo <name>`
→ that scenario (the token after `--demo`, when it is not another flag).
`--demo list` is recognised so the caller can print scenarios and exit.

Add a line to `HELP` documenting `--demo [scenario|list]`.

### Merge point — `src/commands/commit.ts`

Near the top of `main()`, after `parseArgs`:

- If `args.demo` and `args.demoScenario === "list"`: write `listScenarios()` to
  `out` and return `0`.
- Else if `args.demo`: `deps = { ...demoDeps(args.demoScenario), ...deps }`.
  Spreading demo fakes *first* means any explicitly-injected dep (i.e. from a
  test) still overrides the demo fakes. Wrap the `demoDeps` call so an unknown
  scenario name writes a clear error to `err` and returns `1`.

### Convenience — `package.json`

Add script: `"demo": "node ./index.ts --demo"`.

## Data flow

`commit --demo many`
→ `parseArgs` → `demo: true, demoScenario: "many"`
→ `main` merges `demoDeps("many")` into `deps`
→ pipeline runs exactly as normal: `planCommits` calls the fake `collect` +
  fake `callClaude` (→ real `parsePlan`) → `interactiveReview` drives the real
  UI, calling fake `replan` / `regenerateCommit` / `runGit` as keys are pressed
→ accepting invokes the fake `runGit` (no-op) → normal "Created N commit(s)"
  summary.

## Error handling

- Unknown scenario name → clear error to stderr, exit `1` (no stack trace).
- `--demo list` → prints scenario names + one-line descriptions, exit `0`.
- Fake `runGit` always returns success, so the commit-accept path never errors
  in demo mode.

## Testing

- One test: `main(["--demo"], { output })` runs to completion and the captured
  output contains a rendered plan, with no real `claude` or `git` invoked
  (guaranteed by the deterministic fakes; the test injects `nextKey`/`input` as
  the existing tests do to drive the review to a terminal state).
- One test: `main(["--demo", "list"], { output })` returns `0` and lists the
  scenario names.
- One test: an unknown scenario returns `1` and writes an error.

## Isolation rationale

All demo code lives under `src/demo/`. Production modules are untouched. Demo
behaviour is gated entirely on `--demo`, so there is no way for it to leak into
a real run. Faking at the `Deps` layer (rather than deep inside the git/claude
modules) keeps the fakes small and the boundary explicit.
