#!/usr/bin/env node

import { spawnSync, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { realpathSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const mi = argv.indexOf("--model");
  return {
    dryRun: argv.includes("--dry-run"),
    yes: argv.includes("--yes"),
    help: argv.includes("-h") || argv.includes("--help"),
    verbose:
      argv.includes("-v") ||
      argv.includes("--verbose") ||
      argv.includes("--body"),
    model: mi !== -1 ? (argv[mi + 1] ?? null) : null,
  };
}

const HELP = `commit — group tracked changes into logical commits via Claude

Usage: commit [--dry-run] [--yes] [-v|--verbose] [--model <m>] [-h|--help]

  --dry-run        Show the plan and the git commands that would run; change nothing.
  --yes            Skip the review gate and execute the proposed plan.
  -v, --verbose    Add a short body to each commit (default: subject-only, faster).
  --model <m>      Model for planning (default: sonnet; or set COMMIT_MODEL).
  -h, --help       Show this help.

In the interactive picker you can also change the model/effort/verbose settings
(c), regenerate all commits (r) or just the focused one (R) — no need to restart.`;

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

// parseMessage(rawText) -> a single validated commit message { type, scope?,
// subject, body? }. Used when regenerating one commit's message (not a full plan).
export function parseMessage(rawText) {
  const m = extractJson(rawText);
  if (!VALID_TYPES.includes(m.type)) {
    throw new Error(`invalid commit type: ${JSON.stringify(m.type)}`);
  }
  if (typeof m.subject !== "string" || m.subject.trim() === "") {
    throw new Error('message needs a non-empty "subject"');
  }
  const out = { type: m.type, subject: m.subject.trim() };
  if (m.scope) out.scope = String(m.scope);
  if (m.body && String(m.body).trim()) out.body = String(m.body).trim();
  return out;
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
    ? '- Include a short body (1-3 lines) in the "body" field for EVERY commit, explaining the why.'
    : '- Do NOT include a body — give a subject only and omit the "body" field.';
  const shape = allowBody
    ? '{ "files": ["path"], "type": "feat", "scope": "optional", "subject": "...", "body": "..." }'
    : '{ "files": ["path"], "type": "feat", "scope": "optional", "subject": "..." }';
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
    ${shape}
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

// buildRewritePrompt(commit, diff, {verbose, maxDiffChars}) -> prompt to rewrite a
// SINGLE commit's message for its files (used by per-commit / messages-only regen).
export function buildRewritePrompt(
  commit,
  diff,
  { verbose = false, maxDiffChars = 12000 } = {},
) {
  let d = diff;
  if (maxDiffChars && d.length > maxDiffChars) {
    d = d.slice(0, maxDiffChars) + "\n…(diff truncated)";
  }
  const bodyRule = verbose
    ? 'Include a short body (1-3 lines) in the "body" field explaining the why.'
    : 'Do NOT include a body — give a subject only and omit the "body" field.';
  return `Write a single Conventional Commits message for the change to THESE FILES:
${commit.files.map((f) => "- " + f).join("\n")}

Rules: type(scope): subject. Valid types: feat, fix, docs, style, refactor, perf,
test, build, ci, chore, revert. Subject <= 72 chars, imperative, no trailing period.
${bodyRule}

Respond with ONLY minified JSON on a single line (no markdown, no code fences):
{"type":"feat","scope":"optional","subject":"...","body":"optional"}

DIFF (focus only on the files listed above):
${d}
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

// Settings the user can cycle in the in-tool pane.
export const SETTING_MODELS = ["sonnet", "opus", "haiku"];
export const SETTING_EFFORTS = ["low", "medium", "high"];
const SETTING_FIELDS = ["model", "effort", "verbose"];

function cycle(list, val, dir) {
  const i = list.indexOf(val);
  const j = ((i === -1 ? 0 : i) + dir + list.length) % list.length;
  return list[j];
}

// settingsReduce(state, key) -> { state } | { done }. Pure. state is
// { settings: {model, effort, verbose}, cursor }. up/down pick a field, left/right
// change it (verbose toggles), esc/enter/c/q close.
export function settingsReduce({ settings, cursor }, key) {
  const n = SETTING_FIELDS.length;
  if (["escape", "enter", "ctrl-c", "c", "q"].includes(key))
    return { done: true };
  if (key === "up" || key === "k")
    return { state: { settings, cursor: (cursor - 1 + n) % n } };
  if (key === "down" || key === "j")
    return { state: { settings, cursor: (cursor + 1) % n } };
  if (key === "left" || key === "right") {
    const dir = key === "right" ? 1 : -1;
    const f = SETTING_FIELDS[cursor];
    const next = { ...settings };
    if (f === "model") next.model = cycle(SETTING_MODELS, settings.model, dir);
    else if (f === "effort")
      next.effort = cycle(SETTING_EFFORTS, settings.effort, dir);
    else if (f === "verbose") next.verbose = !settings.verbose;
    return { state: { settings: next, cursor } };
  }
  return { state: { settings, cursor } };
}

// renderSettings(state, {color}) -> the settings pane text.
export function renderSettings({ settings, cursor }, { color = true } = {}) {
  const inv = color ? (s) => `\x1b[7m${s}\x1b[0m` : (s) => s;
  const dim = color ? (s) => `\x1b[2m${s}\x1b[0m` : (s) => s;
  const accent = color ? (s) => `\x1b[36m${s}\x1b[0m` : (s) => s;
  const bold = color ? (s) => `\x1b[1m${s}\x1b[0m` : (s) => s;
  const rows = [
    ["model", settings.model],
    ["effort", settings.effort],
    ["verbose", settings.verbose ? "on" : "off"],
  ];
  const lines = [bold("Settings"), ""];
  rows.forEach(([k, v], i) => {
    const focused = i === cursor;
    const marker = focused ? accent("❯ ") : "  ";
    const label = (k + ":").padEnd(9);
    lines.push(marker + label + (focused ? inv(` ${v} `) : ` ${v} `));
  });
  lines.push("");
  lines.push(
    dim("↑/↓ field · ←/→ change · esc close — then r/R to regenerate"),
  );
  return lines.join("\n");
}

const LEGEND =
  "↑/↓ move · enter accept · a all · e edit · s skip · r regen all · R regen one · c settings · q quit";

// renderReview(state, {color, width, height}) -> the full panel text (no cursor
// moves). state is { commits, cursor, committed }. The focused commit gets a
// marker + inverse video. Lines are truncated to `width` so they never wrap (a
// wrapped line would desync any cursor-based redraw), and the commit list is
// windowed to `height` so the panel always fits the viewport with the focused
// commit visible. width/height omitted -> no truncation/windowing (tests).
export function renderReview(
  { commits, cursor, committed },
  { color = true, width, height, settings } = {},
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
  if (settings) {
    head.push(
      dim(
        clip(
          `settings: ${settings.model} · ${settings.effort} · ${settings.verbose ? "verbose" : "subject-only"}`,
        ),
      ),
    );
  }
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

  // Each block: label row, subject row (highlighted when focused), any body
  // lines (dimmed), then the files row. Body lines make blocks variable-height.
  const blocks = commits.map((c, i) => {
    const focused = i === cursor;
    const label = `Commit ${i + 1}`;
    const rows = [
      (focused ? accent("❯ ") : "  ") + (focused ? bold(label) : dim(label)),
    ];
    const msgLines = formatCommitMessage(c).split("\n");
    const subj = clip(msgLines[0], 7); // 5-space indent + 2 pad spaces
    rows.push("     " + (focused ? inv(` ${subj} `) : ` ${subj} `));
    for (const bl of msgLines.slice(1)) {
      if (bl.trim() === "") continue; // skip the blank subject/body separator
      rows.push("       " + dim(clip(bl, 7)));
    }
    rows.push("     " + dim(clip("files: " + c.files.join(", "), 5)));
    return rows;
  });

  // Window the (variable-height) blocks to fit `height`, keeping the focused
  // commit visible by greedily growing a window outward from the cursor.
  let shown = blocks,
    above = 0,
    below = 0;
  if (height) {
    const avail = Math.max(1, height - head.length - footer.length - 2); // -2 for ↑/↓ hints
    const size = blocks.map((b) => b.length);
    let start = cursor,
      end = cursor + 1,
      used = size[cursor];
    for (;;) {
      let grew = false;
      if (end < blocks.length && used + size[end] <= avail) {
        used += size[end++];
        grew = true;
      }
      if (start > 0 && used + size[start - 1] <= avail) {
        used += size[--start];
        grew = true;
      }
      if (!grew) break;
    }
    shown = blocks.slice(start, end);
    above = start;
    below = blocks.length - end;
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
    settings = { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, verbose: false },
    replan, // async (settings) -> plan | null   (full re-plan, may regroup)
    regenerateCommit, // async (commit, settings) -> message | null  (one commit)
  } = {},
) {
  const out = output ?? process.stdout;
  const edit = readLine ?? (async (_p, init) => init); // no-op edit when not wired
  let commits = plan.commits.slice();
  let cursor = 0;
  let conf = { ...settings };
  const committed = [];

  // Redraw by homing the cursor and clearing to end of screen, then reprinting.
  // Robust against shrinking content and (with width-clipping in renderReview)
  // against line wrapping. Pairs with the alt-screen buffer the driver sets up.
  const draw = () => {
    const text = renderReview(
      { commits, cursor, committed },
      { color, width, height, settings: conf },
    );
    out.write("\x1b[H\x1b[J" + text + "\n");
  };
  // Transient notice (model calls are slow); cleared by the next draw().
  const notify = (msg) => out.write("\x1b[H\x1b[J" + msg + "\n");

  const commitAt = (i) => {
    committed.push(executeOne(commits[i], { runGit: git }));
    commits.splice(i, 1);
    if (cursor >= commits.length) cursor = Math.max(0, commits.length - 1);
  };

  // Replace a commit's message but keep its files (regenerated messages drop any
  // prior header override).
  const applyMessage = (i, msg) => {
    if (msg) commits[i] = { ...msg, files: commits[i].files };
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
      } else if (key === "c") {
        // Settings sub-pane: stage changes; regeneration applies them.
        let st = { settings: conf, cursor: 0 };
        for (;;) {
          out.write("\x1b[H\x1b[J" + renderSettings(st, { color }) + "\n");
          const r = settingsReduce(st, await nextKey());
          if (r.done) break;
          st = r.state;
        }
        conf = st.settings;
      } else if (key === "R" && regenerateCommit) {
        out.write("\x1b[H\x1b[J");
        // notify("  regenerating this commit…");
        // applyMessage(cursor, await regenerateCommit(commits[cursor], conf));
        applyMessage(
          cursor,
          await withStatus(
            "regenerating this commit...",
            () => regenerateCommit(commits[cursor], conf),
            { stream: out },
          ),
        );
      } else if (key === "r" && (replan || regenerateCommit)) {
        notify(
          "  regenerate all — [g] regroup · [m] messages only · esc cancel",
        );
        const choice = await nextKey();
        if (choice === "g" && replan) {
          out.write("\x1b[H\x1b[J");
          // notify("  regenerating (regrouping)…");

          const np = await withStatus(
            "regenerating (regrouping)...",
            () => replan(conf),
            { stream: out },
          );
          // replan(conf);
          if (np && np.commits.length) {
            commits = np.commits.slice();
            cursor = 0;
          }
        } else if (choice === "m" && regenerateCommit) {
          for (let i = 0; i < commits.length; i++) {
            out.write("\x1b[H\x1b[J");
            applyMessage(
              i,
              await withStatus(
                `regenerating message ${i + 1}/${commits.length}…`,
                () => regenerateCommit(commits[i], conf),
                { stream: out },
              ),
            );
          }
        }
      }
    } catch (e) {
      out.write(`\nerror: ${e.message}\n`);
      break;
    }
    draw();
  }
  return { committed, settings: conf };
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
// settings persistence
// ---------------------------------------------------------------------------

export const SETTINGS_PATH = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "gitcommit-ai",
  "settings.json",
);

// loadSettings(path) -> saved { model?, effort?, verbose? } or {} if absent/bad.
export function loadSettings(path = SETTINGS_PATH) {
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}

// saveSettings(settings, path) -> true on success. Persists only the known keys
// and never throws (a read-only config dir shouldn't break committing).
export function saveSettings(settings, path = SETTINGS_PATH) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const { model, effort, verbose } = settings;
    writeFileSync(
      path,
      JSON.stringify({ model, effort, verbose }, null, 2) + "\n",
    );
    return true;
  } catch {
    return false;
  }
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

  // Precedence: explicit CLI flag / env > saved settings > built-in default.
  const saved = (deps.loadSettings ?? loadSettings)();
  const model =
    args.model || process.env.COMMIT_MODEL || saved.model || DEFAULT_MODEL;
  const effort = process.env.COMMIT_EFFORT || saved.effort || DEFAULT_EFFORT;
  const verbose = args.verbose || saved.verbose || false;
  const settings0 = { model, effort, verbose };
  const doCollect = deps.collect ?? collect;
  const collectArg = deps.runGit ? { runGit: deps.runGit } : undefined;
  const doClaude =
    deps.callClaude ?? ((prompt) => callClaude(prompt, { model, effort }));
  const git = deps.runGit ?? runGit;
  const statusStream = deps.statusStream ?? process.stderr;

  // Run a prompt against the model using the live (possibly user-changed) settings.
  const planWith = (prompt, s) =>
    deps.callClaude
      ? deps.callClaude(prompt)
      : callClaude(prompt, { model: s.model, effort: s.effort });

  // Re-plan from scratch with current settings (grouping may change).
  const replan =
    deps.replan ??
    (async (s) => {
      const c = doCollect(collectArg);
      if (!c.files.length) return null;
      const p = buildPrompt({
        diff: c.diff,
        files: c.files,
        log: c.log,
        allowBody: s.verbose,
      });
      return parsePlan(
        await planWith(p, s),
        c.files.map((f) => f.path),
      );
    });

  // Rewrite one commit's message for its files (keeps grouping).
  const regenerateCommit =
    deps.regenerateCommit ??
    (async (commit, s) => {
      const c = doCollect(collectArg);
      const p = buildRewritePrompt(commit, c.diff, { verbose: s.verbose });
      return parseMessage(await planWith(p, s));
    });

  try {
    const { diff, files, log } = doCollect(
      deps.runGit ? { runGit: git } : undefined,
    );
    if (files.length === 0) {
      out.write("nothing to commit (tracked changes only)\n");
      return 0;
    }

    const prompt = buildPrompt({ diff, files, log, allowBody: verbose });
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
      statusStream.write(
        `  planned ${n} commit${n === 1 ? "" : "s"} in ${secs}s\n`,
      );
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
        const result = await interactiveReview(plan, {
          nextKey: driver.nextKey,
          readLine: driver.readLine,
          output: out,
          runGit: git,
          color: !process.env.NO_COLOR,
          settings: settings0,
          replan,
          regenerateCommit,
          ...dims,
        });
        committed = result.committed;
        // Remember the settings as they stand for next time. Persist on real runs
        // or when a test injects saveSettings; skip for injected-key runs otherwise.
        const persist = deps.saveSettings ?? (deps.nextKey ? null : saveSettings);
        if (persist) persist(result.settings);
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
