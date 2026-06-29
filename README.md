# gitcommit-ai

Group your **tracked** git changes into logical commits with Conventional-Commits
messages, written by Claude. Nothing is committed until you approve.

Installs as the command **`commit`** (the shorter `gca` is taken by oh-my-zsh's git plugin).

## Requirements

- Node.js >= 18
- The [`claude` CLI](https://docs.claude.com/en/docs/claude-code) on your `PATH`

## Install

```bash
chmod +x gitcommit-ai.mjs
ln -s "$PWD/gitcommit-ai.mjs" /opt/homebrew/bin/commit   # or ~/bin/commit
```

## Usage

```bash
commit                  # collect changes, propose commits, review, then commit
commit --dry-run        # show the plan and the git commands; change nothing
commit --yes            # skip the review gate and commit the proposed plan
commit --verbose        # add a short body to each commit (-v; default: subject-only)
commit --model opus     # plan with a specific model (default: sonnet)
commit --help
```

Model, effort, and verbose can also be changed **inside** the picker (press `c`),
then regenerated without restarting — see [Review gate](#review-gate).

### Remembered settings

Your `model`, `effort`, and `verbose` choices are saved to
`~/.config/gitcommit-ai/settings.json` (honours `XDG_CONFIG_HOME`) after each
interactive run, and loaded on the next one — so a setting you change in the
picker sticks. Precedence is **CLI flag / env var > saved file > built-in default**.
Because saved `verbose` feeds the *initial* plan, turning it on once means every
later run gets bodies from the start (not just after a regenerate).

### Model & speed

Planning runs `claude` as a fast one-shot, not a full agent session:

- **Model** defaults to `sonnet` (good quality, ~7s). Override per-run with
  `--model <m>` or globally with `COMMIT_MODEL=<m>`. Note: on some accounts
  `haiku` is routed slower than `sonnet`, so faster-sounding isn't always faster.
- **Low reasoning effort** (`--effort low`) is the biggest lever — the default
  (high) reasoning makes planning take ~3× longer for no real benefit here.
  Override with `COMMIT_EFFORT=medium|high` for trickier groupings.
- **No MCP servers** are loaded (`--strict-mcp-config`), and a **minimal system
  prompt** replaces Claude Code's default — both cut startup and token overhead.
- Output is kept small: **subject-only by default** (use `-v`/`--verbose` for
  bodies), **minified fence-free JSON**, and the **diff is capped** (~12k chars)
  so a large staged change doesn't balloon the request.

While Claude plans the commits, a live status bar (spinner + elapsed seconds)
animates on stderr — shown only on a TTY, so piping stays clean.

### Review gate

On a terminal, the proposed commits open in an interactive picker. The focused
commit is highlighted; move between them and accept them one at a time:

```
settings: sonnet · low · subject-only
❯ Commit 1
     feat: add greeting
     files: hello.txt
  Commit 2
     docs: update readme
     files: readme.md

↑/↓ move · enter accept · a all · e edit · s skip · r regen all · R regen one · c settings · q quit
```

- `↑`/`↓` (or `k`/`j`) — move focus
- `enter` — commit the focused commit now, then continue with the rest
- `a` — accept and commit all remaining
- `s` — skip (drop the focused commit without committing)
- `e` — edit the focused commit's whole message line, including the tag — change
  `feat(review): x` to `feat(upgrade): x`, or `feat` to `docs`. The suggestion is
  pre-filled and editable; `enter` saves, `esc` cancels and goes back
- `R` — regenerate just the focused commit's message (keeps its files)
- `r` — regenerate **all** commits → choose `g` (regroup from scratch) or `m`
  (keep the current groups, rewrite each message)
- `c` — open the **settings pane**: `↑/↓` pick a field, `←/→` change it
  (`model` sonnet/opus/haiku, `effort` low/medium/high, `verbose` on/off), `esc`
  closes. Changes are staged — press `r`/`R` afterwards to regenerate with them.
- `q` / `Ctrl-C` — quit (commits already made stay)

When stdin is piped (not a TTY), it falls back to a simple line-based prompt.

## What it does and doesn't do

- Considers **tracked** modified/deleted/renamed files only (no untracked files).
- Groups whole files into commits (no hunk-level splitting).
- Claude only produces a plan; all `git add`/`git commit` runs locally after approval.

## Develop

```bash
node --test
```
