#!/usr/bin/env node

import { spawnSync, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const mi = argv.indexOf("--model");
  return {
    dryRun: argv.includes("--dry-run"),
    yes: argv.includes("--yes"),
    help: argv.includes("-h") || argv.includes("--help"),
    body: argv.includes("--body"),
    model: mi !== -1 ? (argv[mi + 1] ?? null) : null,
  };
}

const HELP = `commit — group tracked changes into logical commits via Claude

Usage: commit [--dry-run] [--yes] [--body] [--model <m>] [-h|--help]

  --dry-run     Show the plan and the git commands that would run; change nothing.
  --yes         Skip the review gate and execute the proposed plan.
  --body        Let Claude add commit bodies (default: subject-only, faster).
  --model <m>   Model for planning (default: sonnet; or set COMMIT_MODEL).
  -h, --help    Show this help.`;

// ---------------------------------------------------------------------------
// plan extraction + validation
// ---------------------------------------------------------------------------

export const VALID_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

export function extractJson(text) {
  // Prefer a fenced ```json block, else the first {...} span.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in Claude output");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export function validatePlan(plan, changedPaths) {
  if (!plan || !Array.isArray(plan.commits)) {
    throw new Error('plan must have a "commits" array');
  }
  const expected = new Set(changedPaths);
  const seen = new Set();
  for (const c of plan.commits) {
    if (!Array.isArray(c.files) || c.files.length === 0) {
      throw new Error('each commit needs a non-empty "files" array');
    }
    if (!VALID_TYPES.includes(c.type)) {
      throw new Error(`invalid commit type: ${JSON.stringify(c.type)}`);
    }
    if (typeof c.subject !== "string" || c.subject.trim() === "") {
      throw new Error('each commit needs a non-empty "subject"');
    }
    for (const f of c.files) {
      if (!expected.has(f))
        throw new Error(`plan references unknown file: ${f}`);
      if (seen.has(f))
        throw new Error(`file assigned to more than one commit: ${f}`);
      seen.add(f);
    }
  }
  const missing = [...expected].filter((f) => !seen.has(f));
  if (missing.length) {
    throw new Error(`changed files missing from plan: ${missing.join(", ")}`);
  }
  return plan;
}

export function parsePlan(rawText, changedPaths) {
  return validatePlan(extractJson(rawText), changedPaths);
}

// ---------------------------------------------------------------------------
// status parsing + message formatting
// ---------------------------------------------------------------------------

export function getChangedFiles(porcelain) {
  const out = [];
  for (const line of porcelain.split("\n")) {
    if (line.trim() === "") continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === "??") continue; // untracked
    if (xy[0] === "R" || xy[1] === "R") {
      const [oldPath, newPath] = rest.split(" -> ");
      out.push({ status: "D", path: oldPath });
      out.push({ status: "A", path: newPath });
      continue;
    }
    const status = xy.trim()[0] || "M";
    out.push({ status, path: rest });
  }
  return out;
}

export function formatCommitMessage({ type, scope, subject, body, header }) {
  // `header` is a verbatim override of the first line (used when the user edits
  // the whole tag+subject, e.g. "feat(review): x" -> "feat(upgrade): x").
  const head =
    header != null
      ? header
      : scope
        ? `${type}(${scope}): ${subject}`
        : `${type}: ${subject}`;
  return body && body.trim() ? `${head}\n\n${body.trim()}` : head;
}

// ---------------------------------------------------------------------------
// prompt building
// ---------------------------------------------------------------------------

export function buildPrompt({
  diff,
  files,
  log,
  allowBody = false,
  maxDiffChars = 12000,
}) {
  const fileList = files.map((f) => `${f.status}\t${f.path}`).join("\n");
  let d = diff;
  let note = "";
  if (maxDiffChars && d.length > maxDiffChars) {
    d = d.slice(0, maxDiffChars);
    note = `\n…(diff truncated at ${maxDiffChars} chars — rely on the file list above for grouping)`;
  }
  const bodyRule = allowBody
    ? '- Add a short body only when the "why" is not obvious from the subject.'
    : '- Do NOT include a body — give a subject only and omit the "body" field.';
  return `You are a git commit planner. Group the following CHANGED FILES into one or
more logical commits and write a Conventional Commits message for each.

Rules:
- Every changed file must appear in exactly one commit. Do not invent file paths.
- Use Conventional Commits: type(scope): subject. Valid types: feat, fix, docs,
  style, refactor, perf, test, build, ci, chore, revert. Keep subject <= 72 chars,
  imperative mood, no trailing period.
- Order commits so prerequisite changes come first.
${bodyRule}

Respond with ONLY a JSON object of this exact shape (the example is pretty-printed
for readability — your output must be MINIFIED on a single line, no markdown, no
code fences, no extra whitespace):
{
  "commits": [
    { "files": ["path"], "type": "feat", "scope": "optional", "subject": "..." }
  ]
}

CHANGED FILES (git status code + path):
${fileList}

RECENT HISTORY (for style reference):
${log}

DIFF:
${d}${note}
`;
}

// ---------------------------------------------------------------------------
// git helpers + collection
// ---------------------------------------------------------------------------

export function runGit(args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd: opts.cwd ?? process.cwd(),
    encoding: "utf8",
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export function assertRepoState({ runGit: git = runGit } = {}) {
  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    throw new Error("not inside a git repo");
  }
  const head = git(["symbolic-ref", "-q", "HEAD"]);
  if (head.status !== 0) {
    throw new Error("detached HEAD — checkout a branch before committing");
  }
  const merge = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (merge.status === 0) {
    throw new Error("repository is mid-merge — resolve it first");
  }
}

export function collect({ runGit: git = runGit } = {}) {
  assertRepoState({ runGit: git });
  const diff = git(["diff", "HEAD", "--"]).stdout;
  const status = git(["status", "--porcelain"]).stdout;
  const files = getChangedFiles(status);
  const log = git(["log", "-n", "20", "--oneline"]).stdout;
  return { diff, files, log };
}

// ---------------------------------------------------------------------------
// status bar (spinner + elapsed + label on stderr, TTY only)
// ---------------------------------------------------------------------------

export const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// statusLine(frame, elapsedSeconds, label) -> the visible status text (no CR/clear).
export function statusLine(frame, elapsed, label) {
  return `  ${frame}  commit · ${elapsed}s · ${label || "working…"}`;
}

// withStatus(label, fn, {stream}) -> runs the async fn while animating a status
// line on `stream` (default stderr). Only animates on a TTY; always clears the
// line when fn settles, success or failure. fn must be non-blocking (await-able)
// for the spinner to tick.
export async function withStatus(label, fn, { stream = process.stderr } = {}) {
  const show = !!stream.isTTY;
  const start = Date.now();
  let fi = 0,
    ticker;
  if (show) {
    ticker = setInterval(() => {
      fi = (fi + 1) % FRAMES.length;
      const el = Math.floor((Date.now() - start) / 1000);
      const spin = `\x1b[36m${FRAMES[fi]}\x1b[0m`;
      stream.write("\r\x1b[2K" + statusLine(spin, el, label));
    }, 80);
    if (typeof ticker.unref === "function") ticker.unref();
  }
  try {
    return await fn();
  } finally {
    if (show) {
      clearInterval(ticker);
      stream.write("\r\x1b[2K");
    }
  }
}

// ---------------------------------------------------------------------------
// claude invocation
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "sonnet";
// Reasoning effort dominates latency here: the default (high) reasoning makes a
// trivial planning call take ~17s; "low" gets the same JSON in ~5s. Override with
// COMMIT_EFFORT if you want more reasoning for tricky groupings.
export const DEFAULT_EFFORT = "low";

// Minimal system prompt replaces Claude Code's large default agent prompt — this
// is a one-shot text task, so a tiny prompt cuts both latency and tokens.
const PLANNER_SYSTEM_PROMPT =
  "You are a git commit-message planner. Output only minified JSON matching the requested shape. No prose, no code fences.";

function defaultClaudeRunner(prompt, model, effort) {
  return new Promise((resolve) => {
    // Speed flags: --strict-mcp-config (no --mcp-config) loads ZERO MCP servers;
    // a small --system-prompt + fast --model + low --effort keep latency down.
    // (Note: --bare is NOT used — it skips the settings that hold auth.)
    const args = [
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
    execFile(
      "claude",
      args,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const status = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({ status, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

export async function callClaude(
  prompt,
  { runner, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT } = {},
) {
  const run = runner ?? ((p) => defaultClaudeRunner(p, model, effort));
  const res = await run(prompt);
  if (res.status !== 0) {
    throw new Error(
      `claude CLI failed: ${(res.stderr || "").trim() || "unknown error"}`,
    );
  }
  try {
    const wrapper = JSON.parse(res.stdout);
    if (wrapper && typeof wrapper.result === "string") return wrapper.result;
  } catch {
    /* not wrapper JSON — fall through */
  }
  return res.stdout;
}

// ---------------------------------------------------------------------------
// review gate
// ---------------------------------------------------------------------------

export function renderPlan(plan) {
  return plan.commits
    .map((c, i) => {
      const msg = formatCommitMessage(c)
        .split("\n")
        .map((l) => "    " + l)
        .join("\n");
      return `Commit ${i + 1}:\n${msg}\n    files: ${c.files.join(", ")}`;
    })
    .join("\n\n");
}

export async function reviewGate(plan, { input, output, autoYes } = {}) {
  const out = output ?? process.stdout;
  if (autoYes) return plan;
  let commits = plan.commits.slice();
  for (;;) {
    out.write("\n" + renderPlan({ commits }) + "\n");
    out.write("\n[a]pprove all / [e]dit <n> / [s]kip <n> / [q]uit: ");
    const answer = ((await input()) || "q").trim();
    const [cmd, nStr] = answer.split(/\s+/);
    const n = Number(nStr) - 1;
    if (cmd === "a") return { ...plan, commits };
    if (cmd === "q") return null;
    if (cmd === "s" && commits[n]) {
      commits.splice(n, 1);
      if (!commits.length) return null;
      continue;
    }
    if (cmd === "e" && commits[n]) {
      out.write(`new subject for commit ${n + 1}: `);
      const subject = ((await input()) || "").trim();
      if (subject) commits[n] = { ...commits[n], subject };
      continue;
    }
    out.write("unrecognized choice\n");
  }
}

// ---------------------------------------------------------------------------
// interactive review (arrow navigation, per-commit accept)
// ---------------------------------------------------------------------------

// decodeKeys(str) -> normalized key tokens. Pure, so it is unit-testable without
// a terminal. Handles CSI sequences (arrows/home/end), enter, ctrl-c, escape,
// backspace, and plain characters.
const CSI = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  "1~": "home",
  "4~": "end",
  "3~": "delete",
};
export function decodeKeys(s) {
  const keys = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\x1b" && s[i + 1] === "[") {
      // CSI: ESC [ <params> <final letter or ~>
      let j = i + 2,
        params = "";
      while (j < s.length && !/[A-Za-z~]/.test(s[j])) {
        params += s[j];
        j++;
      }
      const final = s[j] ?? "";
      const tok = CSI[params + final] || CSI[final];
      if (tok) keys.push(tok);
      i = j + 1;
      continue;
    }
    if (ch === "\x1b") keys.push("escape");
    else if (ch === "\r" || ch === "\n") keys.push("enter");
    else if (ch === "\x03") keys.push("ctrl-c");
    else if (ch === "\x7f" || ch === "\x08") keys.push("backspace");
    else keys.push(ch);
    i++;
  }
  return keys;
}

// editorReduce(state, key) -> { state } | { done, value } | { done, cancelled }.
// Pure single-line text editor over state { buf, pos }. enter accepts, escape /
// ctrl-c cancel, backspace/left/right/home/end edit, printable chars insert.
export function editorReduce({ buf, pos }, key) {
  switch (key) {
    case "enter":
      return { done: true, value: buf };
    case "escape":
    case "ctrl-c":
      return { done: true, cancelled: true };
    case "backspace":
      return pos > 0
        ? {
            state: {
              buf: buf.slice(0, pos - 1) + buf.slice(pos),
              pos: pos - 1,
            },
          }
        : { state: { buf, pos } };
    case "left":
      return { state: { buf, pos: Math.max(0, pos - 1) } };
    case "right":
      return { state: { buf, pos: Math.min(buf.length, pos + 1) } };
    case "home":
      return { state: { buf, pos: 0 } };
    case "end":
      return { state: { buf, pos: buf.length } };
    default:
      if (typeof key === "string" && key.length === 1 && key >= " ") {
        return {
          state: {
            buf: buf.slice(0, pos) + key + buf.slice(pos),
            pos: pos + 1,
          },
        };
      }
      return { state: { buf, pos } };
  }
}

const LEGEND =
  "↑/↓ move · enter accept · a accept all · s skip · e edit · q quit";

// renderReview(state, {color, width, height}) -> the full panel text (no cursor
// moves). state is { commits, cursor, committed }. The focused commit gets a
// marker + inverse video. Lines are truncated to `width` so they never wrap (a
// wrapped line would desync any cursor-based redraw), and the commit list is
// windowed to `height` so the panel always fits the viewport with the focused
// commit visible. width/height omitted -> no truncation/windowing (tests).
export function renderReview(
  { commits, cursor, committed },
  { color = true, width, height } = {},
) {
  const inv = color ? (s) => `\x1b[7m${s}\x1b[0m` : (s) => s;
  const dim = color ? (s) => `\x1b[2m${s}\x1b[0m` : (s) => s;
  const accent = color ? (s) => `\x1b[36m${s}\x1b[0m` : (s) => s;
  const bold = color ? (s) => `\x1b[1m${s}\x1b[0m` : (s) => s;
  // Clip raw (un-styled) text to the available columns, then style it.
  const clip = (s, indent = 0) => {
    const w = width ? width - indent : 0;
    return w && s.length > w ? s.slice(0, Math.max(0, w - 1)) + "…" : s;
  };

  const head = [];
  if (committed.length) {
    head.push(
      dim(
        clip(
          `✓ committed ${committed.length}: ${committed.map((c) => c.subject).join(", ")}`,
        ),
      ),
    );
  }
  const footer = ["", dim(clip(LEGEND))];

  const BLOCK_ROWS = 3; // label + message + files
  const blocks = commits.map((c, i) => {
    const focused = i === cursor;
    const h = clip(formatCommitMessage(c).split("\n")[0], 7); // 5-space indent + 2 pad spaces
    const f = clip("files: " + c.files.join(", "), 5);
    const label = `Commit ${i + 1}`;
    const labelRow =
      (focused ? accent("❯ ") : "  ") + (focused ? bold(label) : dim(label));
    const msgRow = "     " + (focused ? inv(` ${h} `) : ` ${h} `);
    return [labelRow, msgRow, "     " + dim(f)];
  });

  // Window the list to fit `height`, keeping the focused commit on screen.
  let shown = blocks,
    above = 0,
    below = 0;
  if (height) {
    const avail = Math.max(BLOCK_ROWS, height - head.length - footer.length);
    const maxBlocks = Math.max(1, Math.floor(avail / BLOCK_ROWS) - 1); // -1 leaves room for ↑/↓ hints
    if (blocks.length > maxBlocks) {
      let start = cursor - Math.floor(maxBlocks / 2);
      start = Math.max(0, Math.min(start, blocks.length - maxBlocks));
      shown = blocks.slice(start, start + maxBlocks);
      above = start;
      below = blocks.length - (start + maxBlocks);
    }
  }

  const lines = [...head];
  if (above) lines.push(dim(`  ↑ ${above} more`));
  for (const b of shown) lines.push(...b);
  if (below) lines.push(dim(`  ↓ ${below} more`));
  lines.push(...footer);
  return lines.join("\n");
}

// interactiveReview(plan, {nextKey, readLine, output, runGit, color}) drives the
// arrow-key gate. nextKey()/readLine() are injectable so the loop is testable
// without raw-mode stdin. Commits happen incrementally via executeOne.
export async function interactiveReview(
  plan,
  {
    nextKey,
    readLine,
    output,
    runGit: git = runGit,
    color = true,
    width,
    height,
  } = {},
) {
  const out = output ?? process.stdout;
  const edit = readLine ?? (async (_p, init) => init); // no-op edit when not wired
  let commits = plan.commits.slice();
  let cursor = 0;
  const committed = [];

  // Redraw by homing the cursor and clearing to end of screen, then reprinting.
  // Robust against shrinking content and (with width-clipping in renderReview)
  // against line wrapping. Pairs with the alt-screen buffer the driver sets up.
  const draw = () => {
    const text = renderReview(
      { commits, cursor, committed },
      { color, width, height },
    );
    out.write("\x1b[H\x1b[J" + text + "\n");
  };

  const commitAt = (i) => {
    committed.push(executeOne(commits[i], { runGit: git }));
    commits.splice(i, 1);
    if (cursor >= commits.length) cursor = Math.max(0, commits.length - 1);
  };

  draw();
  while (commits.length > 0) {
    const key = await nextKey();
    const n = commits.length;
    try {
      if (key === "up" || key === "k") cursor = (cursor - 1 + n) % n;
      else if (key === "down" || key === "j") cursor = (cursor + 1) % n;
      else if (key === "q" || key === "ctrl-c") break;
      else if (key === "s") {
        commits.splice(cursor, 1);
        if (cursor >= commits.length) cursor = Math.max(0, commits.length - 1);
      } else if (key === "e") {
        // Pre-fill with the full header (tag + subject) so the user can change
        // the tag too, e.g. "feat(review): x" -> "feat(upgrade): x". The edited
        // line is stored verbatim as a header override. null result = cancelled.
        const current = formatCommitMessage(commits[cursor]).split("\n")[0];
        const edited = await edit(
          "  edit message (enter save · esc cancel): ",
          current,
        );
        if (edited != null && edited.trim())
          commits[cursor] = { ...commits[cursor], header: edited.trim() };
      } else if (key === "enter") {
        commitAt(cursor);
      } else if (key === "a") {
        while (commits.length) commitAt(0);
      }
    } catch (e) {
      out.write(`\nerror: ${e.message}\n`);
      break;
    }
    draw();
  }
  return { committed };
}

// makeRawKeyDriver(input, output) -> {nextKey, readLine, close} backed by a real
// raw-mode TTY. Kept thin; the testable logic lives in decodeKeys/interactiveReview.
function makeRawKeyDriver(input = process.stdin, output = process.stdout) {
  const wasRaw = !!input.isRaw;
  if (input.setRawMode) input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  output.write("\x1b[?1049h\x1b[?25l"); // enter alt screen, hide cursor

  const queue = [];
  const waiters = [];
  const onData = (chunk) => {
    for (const key of decodeKeys(chunk)) {
      if (waiters.length) waiters.shift()(key);
      else queue.push(key);
    }
  };
  input.on("data", onData);

  const nextKey = () =>
    new Promise((res) => {
      if (queue.length) res(queue.shift());
      else waiters.push(res);
    });

  // Raw-mode single-line editor: pre-filled with `initial`, fully editable, with
  // enter to save and esc/ctrl-c to cancel (resolves null). Stays in raw mode.
  const readLine = (promptText, initial = "") =>
    new Promise((res) => {
      input.removeListener("data", onData);
      let state = { buf: initial, pos: initial.length };
      const render = () => {
        output.write(
          "\x1b[H\x1b[J" +
            promptText +
            state.buf +
            `\x1b[1;${promptText.length + state.pos + 1}H`,
        );
      };
      output.write("\x1b[?25h"); // show cursor for typing
      render();
      const onKey = (chunk) => {
        for (const key of decodeKeys(chunk)) {
          const r = editorReduce(state, key);
          if (r.done) {
            input.removeListener("data", onKey);
            output.write("\x1b[?25l"); // hide cursor again
            input.on("data", onData);
            res(r.cancelled ? null : r.value);
            return;
          }
          state = r.state;
        }
        render();
      };
      input.on("data", onKey);
    });

  const close = () => {
    input.removeListener("data", onData);
    output.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alt screen
    if (input.setRawMode) input.setRawMode(wasRaw);
    input.pause();
  };

  return { nextKey, readLine, close };
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

// executeOne(commit, {runGit}) -> {subject, files}. Stages exactly this commit's
// files (after clearing the index) and commits them. Throws on any git failure.
export function executeOne(commit, { runGit: git = runGit } = {}) {
  const reset = git(["reset", "-q"]);
  if (reset.status !== 0) throw new Error(`git reset failed: ${reset.stderr}`);
  const add = git(["add", "--", ...commit.files]);
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`);
  const msg = formatCommitMessage(commit);
  const [subject, ...bodyParts] = msg.split("\n\n");
  const args = ["commit", "-m", subject];
  if (bodyParts.length) args.push("-m", bodyParts.join("\n\n"));
  const commit_ = git(args);
  if (commit_.status !== 0)
    throw new Error(`git commit failed: ${commit_.stderr}`);
  return { subject, files: commit.files };
}

export function execute(plan, { runGit: git = runGit } = {}) {
  const committed = [];
  for (const c of plan.commits) committed.push(executeOne(c, { runGit: git }));
  return { committed };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function dryRunCommands(plan) {
  return plan.commits
    .map(
      (c) =>
        `git reset -q && git add -- ${c.files.join(" ")} && git commit -m ${JSON.stringify(c.subject)}`,
    )
    .join("\n");
}

export async function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const out = deps.output ?? process.stdout;
  const err = deps.error ?? process.stderr;
  if (args.help) {
    out.write(HELP + "\n");
    return 0;
  }

  const model = args.model || process.env.COMMIT_MODEL || DEFAULT_MODEL;
  const effort = process.env.COMMIT_EFFORT || DEFAULT_EFFORT;
  const doCollect = deps.collect ?? collect;
  const doClaude =
    deps.callClaude ?? ((prompt) => callClaude(prompt, { model, effort }));
  const git = deps.runGit ?? runGit;
  const statusStream = deps.statusStream ?? process.stderr;

  try {
    const { diff, files, log } = doCollect(
      deps.runGit ? { runGit: git } : undefined,
    );
    if (files.length === 0) {
      out.write("nothing to commit (tracked changes only)\n");
      return 0;
    }

    const prompt = buildPrompt({ diff, files, log, allowBody: args.body });
    const startedAt = Date.now();
    const raw = await withStatus("planning commits", () => doClaude(prompt), {
      stream: statusStream,
    });
    const plan = parsePlan(
      raw,
      files.map((f) => f.path),
    );

    // Per-run timing readout on the status stream (TTY only, so pipes stay clean).
    if (statusStream.isTTY) {
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      const n = plan.commits.length;
      statusStream.write(`  planned ${n} commit${n === 1 ? "" : "s"} in ${secs}s\n`);
    }

    out.write(renderPlan(plan) + "\n");
    if (args.dryRun) {
      out.write(
        "\n--- git commands (dry run) ---\n" + dryRunCommands(plan) + "\n",
      );
      return 0;
    }

    let committed;
    if (args.yes) {
      committed = execute(plan, { runGit: git }).committed;
    } else if (
      deps.nextKey ||
      (process.stdin.isTTY && deps.input === undefined)
    ) {
      // Interactive arrow-key gate (real TTY, or injected keys for tests).
      const driver = deps.nextKey
        ? {
            nextKey: deps.nextKey,
            readLine: deps.readLine ?? (async () => ""),
            close: () => {},
          }
        : makeRawKeyDriver(process.stdin, process.stdout);
      const dims = deps.nextKey
        ? {}
        : {
            width: process.stdout.columns || 80,
            height: process.stdout.rows || 24,
          };
      try {
        committed = (
          await interactiveReview(plan, {
            nextKey: driver.nextKey,
            readLine: driver.readLine,
            output: out,
            runGit: git,
            color: !process.env.NO_COLOR,
            ...dims,
          })
        ).committed;
      } finally {
        driver.close();
      }
    } else {
      // Line-based fallback for piped / non-TTY input.
      let input = deps.input,
        rl;
      if (!input) {
        rl = createInterface({ input: process.stdin, output: process.stdout });
        input = () => new Promise((res) => rl.question("", res));
      }
      const approved = await reviewGate(plan, { input, output: out });
      if (rl) rl.close();
      if (!approved) {
        out.write("aborted — nothing committed\n");
        return 1;
      }
      committed = execute(approved, { runGit: git }).committed;
    }

    if (!committed.length) {
      out.write("\nnothing committed\n");
      return 1;
    }
    out.write(
      `\nCreated ${committed.length} commit(s):\n` +
        committed.map((c) => `  • ${c.subject}`).join("\n") +
        "\n",
    );
    return 0;
  } catch (e) {
    err.write(`error: ${e.message}\n`);
    return 1;
  }
}

// Run main() only when invoked as a script, not when imported by tests.
// Resolve the real path of argv[1] so invocation through a symlink (e.g. a
// `commit` symlink on PATH) still matches this module's file URL.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
