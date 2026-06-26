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
commit            # collect changes, propose commits, review, then commit
commit --dry-run  # show the plan and the git commands; change nothing
commit --yes      # skip the review gate and commit the proposed plan
commit --help
```

While Claude plans the commits, a live status bar (spinner + elapsed seconds)
animates on stderr — shown only on a TTY, so piping stays clean.

At the review gate: `a` approve all, `e <n>` edit a message, `s <n>` skip a
commit, `q` quit without committing.

## What it does and doesn't do

- Considers **tracked** modified/deleted/renamed files only (no untracked files).
- Groups whole files into commits (no hunk-level splitting).
- Claude only produces a plan; all `git add`/`git commit` runs locally after approval.

## Develop

```bash
node --test
```
