# gitcommit-ai — Design Spec

**Date:** 2026-06-26
**Status:** Approved (brainstorming complete)

## Overview

A single-file Node.js CLI that inspects **tracked** working-tree changes in a git
repository, asks the `claude` CLI to group them into logical commits with
[Conventional Commits](https://www.conventionalcommits.org/) messages, presents the
plan for review, and creates the commits **only after the user confirms**.

Claude is used purely as a planner. It never runs git. All repository mutation
happens locally, after explicit user approval.

- **Repo name:** `gitcommit-ai`
- **Command name:** `commit` (the preferred `gca` clashes with the oh-my-zsh git
  plugin alias `gca='git commit --verbose --all'`)
- **Language/runtime:** Node.js, single file, standard library only (no npm deps)
- **Claude integration:** shells out to the `claude` CLI

## Goals

- Replace the manual "`git add .` → write a commit message" loop with an assisted
  flow that groups related changes and writes good messages.
- Keep the user in control: nothing is committed without an explicit yes.
- Be safe by construction: never silently drop or mis-stage a change.

## Non-goals (YAGNI)

- **Hunk-level splitting.** Commits group **whole files** only. (The data model
  leaves room to add hunk-level later, but it is not built now.)
- **Untracked/new files.** Only modified and deleted *tracked* files are considered.
- **Pushing, amending, rebasing, or any history rewriting.**
- **Configurable message conventions.** Conventional Commits is the only style.

## Architecture

A single executable file (`gitcommit-ai.mjs`) organized as a six-stage pipeline of
small, independently-testable functions:

```
collect → buildPrompt → callClaude → parsePlan → reviewGate → execute
```

### Stages

1. **`collect`** — Gather context about tracked changes:
   - Preconditions: confirm we are inside a git work tree, not detached HEAD, and
     not mid-merge/rebase. Abort with a clear message otherwise.
   - `git diff HEAD --` for tracked changes (staged + unstaged), so the diff
     reflects the full tracked delta regardless of current index state.
   - Changed-file list from `git status --porcelain`, filtered to tracked files
     (exclude `??` untracked entries). Capture status code (M/D/R/etc.) per file.
   - `git log -n 20 --oneline` as lightweight style context for the prompt.
   - If there are no tracked changes, print "nothing to commit" and exit 0.

2. **`buildPrompt`** — Construct the instruction string for Claude. It includes the
   diff, the changed-file list, and recent log, and asks for **strict JSON** output:
   ```json
   {
     "commits": [
       {
         "files": ["path/a.js", "path/b.js"],
         "type": "feat",
         "scope": "auth",        // optional
         "subject": "add login form",
         "body": "..."           // optional
       }
     ]
   }
   ```
   Rules conveyed to Claude: every changed file must appear in exactly one commit;
   no file may be invented; subjects follow Conventional Commits and stay <= ~72
   chars; order commits so dependencies come first.

3. **`callClaude`** — Shell out: `claude -p "<prompt>" --output-format json`.
   Read the wrapper's `.result` field (the model's text), then extract the JSON
   object from it, tolerant of surrounding prose or ```` ```json ```` code fences.

4. **`parsePlan`** — Validate the plan against the actual changed-file set:
   - JSON parses and matches the expected shape.
   - The union of all `files` across commits **equals** the changed-file set —
     no missing files, no unknown files, no file in two commits.
   - Each commit has a valid `type` and non-empty `subject`.
   - Any failure is a hard error: show the raw Claude output and abort, changing
     nothing.

5. **`reviewGate`** — Print each proposed commit (rendered message + file list) and
   prompt: `[a]pprove all / [e]dit a message / [s]kip a commit / [q]uit`.
   - `edit` lets the user rewrite a commit's message (opens `$EDITOR`, or inline).
   - `skip` drops a commit from the plan; its files remain uncommitted.
   - `quit` aborts with no changes.
   - Nothing is staged or committed until the user approves.

6. **`execute`** — For each approved commit, in plan order:
   - `git reset -q` to clear the index (start from a clean slate each commit).
   - `git add -- <files>` for that commit's files.
   - `git commit -m <subject> [-m <body>]`.
   - Stop on the first git error, report it, and leave the repo as-is for the user
     to inspect. Print a summary of commits created.

## Data flow & safety

- Claude receives the diff + file list + recent log, and returns **only a plan**
  (JSON). It never executes git.
- All staging and committing happens locally in `execute`, after the review gate.
- The `parsePlan` invariant (plan file-set == actual changed file-set) guarantees no
  tracked change is silently dropped or mis-assigned.

## CLI surface

```
commit [--dry-run] [--yes] [-h|--help]
```

- (no flags) — full pipeline through the interactive review gate.
- `--dry-run` — run `collect → parsePlan`, print the plan and the exact git commands
  that *would* run, then exit. Never mutates the repo.
- `--yes` — skip the review gate and execute the plan as proposed (for trusted/
  scripted use). Mutually informative with `--dry-run` (dry-run wins if both given).
- `-h`/`--help` — usage.

## Edge cases

| Situation | Behavior |
|---|---|
| Not a git repo | Abort with message, exit non-zero |
| Detached HEAD / mid-merge or rebase | Abort with message |
| No tracked changes | "nothing to commit", exit 0 |
| Only untracked files present | Treated as no tracked changes → exit 0 with hint |
| `claude` CLI missing or errors | Report stderr, abort, change nothing |
| Invalid/inconsistent JSON from Claude | Show raw output, abort, change nothing |
| File changed but absent from plan | `parsePlan` fails → abort |
| Plan references unknown file | `parsePlan` fails → abort |
| Renamed files (`R` status) | Both old and new paths reconciled in the changed-file set |
| git error mid-execute | Stop, report, leave repo for inspection |

## Testing (TDD)

- **Pure functions** (`buildPrompt`, `parsePlan`, plan/file-set reconciliation) —
  unit-tested directly with crafted inputs, including all `parsePlan` failure modes.
- **`collect` / `execute`** — tested against a throwaway temp git repo fixture
  created per-test.
- **`callClaude`** — the `claude` invocation is mocked; we test prompt assembly and
  output extraction (fences, surrounding prose), not the real CLI.
- Test runner: Node's built-in `node:test` + `node:assert` (no deps).

## Distribution

- Single executable file `gitcommit-ai.mjs` with `#!/usr/bin/env node` shebang,
  `chmod +x`.
- Installed by symlinking it onto `PATH` as `commit` (e.g. into `/opt/homebrew/bin`
  or `~/bin`). A short `install` note in the README documents this.
- No `npm install`; Node standard library only.

## Open items

None. Ready for implementation planning.
