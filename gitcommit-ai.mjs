#!/usr/bin/env node

import { spawnSync, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    yes: argv.includes('--yes'),
    help: argv.includes('-h') || argv.includes('--help'),
  };
}

const HELP = `commit — group tracked changes into logical commits via Claude

Usage: commit [--dry-run] [--yes] [-h|--help]

  --dry-run   Show the plan and the git commands that would run; change nothing.
  --yes       Skip the review gate and execute the proposed plan.
  -h, --help  Show this help.`;

// ---------------------------------------------------------------------------
// plan extraction + validation
// ---------------------------------------------------------------------------

export const VALID_TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'chore', 'revert',
];

export function extractJson(text) {
  // Prefer a fenced ```json block, else the first {...} span.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in Claude output');
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
    if (typeof c.subject !== 'string' || c.subject.trim() === '') {
      throw new Error('each commit needs a non-empty "subject"');
    }
    for (const f of c.files) {
      if (!expected.has(f)) throw new Error(`plan references unknown file: ${f}`);
      if (seen.has(f)) throw new Error(`file assigned to more than one commit: ${f}`);
      seen.add(f);
    }
  }
  const missing = [...expected].filter((f) => !seen.has(f));
  if (missing.length) {
    throw new Error(`changed files missing from plan: ${missing.join(', ')}`);
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
  for (const line of porcelain.split('\n')) {
    if (line.trim() === '') continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === '??') continue; // untracked
    if (xy[0] === 'R' || xy[1] === 'R') {
      const [oldPath, newPath] = rest.split(' -> ');
      out.push({ status: 'D', path: oldPath });
      out.push({ status: 'A', path: newPath });
      continue;
    }
    const status = xy.trim()[0] || 'M';
    out.push({ status, path: rest });
  }
  return out;
}

export function formatCommitMessage({ type, scope, subject, body }) {
  const head = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;
  return body && body.trim() ? `${head}\n\n${body.trim()}` : head;
}

// ---------------------------------------------------------------------------
// prompt building
// ---------------------------------------------------------------------------

export function buildPrompt({ diff, files, log }) {
  const fileList = files.map((f) => `${f.status}\t${f.path}`).join('\n');
  return `You are a git commit planner. Group the following CHANGED FILES into one or
more logical commits and write a Conventional Commits message for each.

Rules:
- Every changed file must appear in exactly one commit. Do not invent file paths.
- Use Conventional Commits: type(scope): subject. Valid types: feat, fix, docs,
  style, refactor, perf, test, build, ci, chore, revert. Keep subject <= 72 chars,
  imperative mood, no trailing period.
- Order commits so prerequisite changes come first.
- Add a short body only when the "why" is not obvious from the subject.

Respond with ONLY a JSON object of this exact shape (no prose):
{
  "commits": [
    { "files": ["path"], "type": "feat", "scope": "optional", "subject": "...", "body": "optional" }
  ]
}

CHANGED FILES (git status code + path):
${fileList}

RECENT HISTORY (for style reference):
${log}

DIFF:
${diff}
`;
}

// ---------------------------------------------------------------------------
// git helpers + collection
// ---------------------------------------------------------------------------

export function runGit(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: opts.cwd ?? process.cwd(),
    encoding: 'utf8',
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function assertRepoState({ runGit: git = runGit } = {}) {
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw new Error('not inside a git repo');
  }
  const head = git(['symbolic-ref', '-q', 'HEAD']);
  if (head.status !== 0) {
    throw new Error('detached HEAD — checkout a branch before committing');
  }
  const merge = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  if (merge.status === 0) {
    throw new Error('repository is mid-merge — resolve it first');
  }
}

export function collect({ runGit: git = runGit } = {}) {
  assertRepoState({ runGit: git });
  const diff = git(['diff', 'HEAD', '--']).stdout;
  const status = git(['status', '--porcelain']).stdout;
  const files = getChangedFiles(status);
  const log = git(['log', '-n', '20', '--oneline']).stdout;
  return { diff, files, log };
}

// ---------------------------------------------------------------------------
// status bar (spinner + elapsed + label on stderr, TTY only)
// ---------------------------------------------------------------------------

export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// statusLine(frame, elapsedSeconds, label) -> the visible status text (no CR/clear).
export function statusLine(frame, elapsed, label) {
  return `  ${frame}  commit · ${elapsed}s · ${label || 'working…'}`;
}

// withStatus(label, fn, {stream}) -> runs the async fn while animating a status
// line on `stream` (default stderr). Only animates on a TTY; always clears the
// line when fn settles, success or failure. fn must be non-blocking (await-able)
// for the spinner to tick.
export async function withStatus(label, fn, { stream = process.stderr } = {}) {
  const show = !!stream.isTTY;
  const start = Date.now();
  let fi = 0, ticker;
  if (show) {
    ticker = setInterval(() => {
      fi = (fi + 1) % FRAMES.length;
      const el = Math.floor((Date.now() - start) / 1000);
      const spin = `\x1b[36m${FRAMES[fi]}\x1b[0m`;
      stream.write('\r\x1b[2K' + statusLine(spin, el, label));
    }, 80);
    if (typeof ticker.unref === 'function') ticker.unref();
  }
  try {
    return await fn();
  } finally {
    if (show) { clearInterval(ticker); stream.write('\r\x1b[2K'); }
  }
}

// ---------------------------------------------------------------------------
// claude invocation
// ---------------------------------------------------------------------------

function defaultClaudeRunner(prompt) {
  return new Promise((resolve) => {
    execFile('claude', ['-p', prompt, '--output-format', 'json'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const status = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ status, stdout: stdout ?? '', stderr: stderr ?? '' });
      });
  });
}

export async function callClaude(prompt, { runner } = {}) {
  const run = runner ?? defaultClaudeRunner;
  const res = await run(prompt);
  if (res.status !== 0) {
    throw new Error(`claude CLI failed: ${(res.stderr || '').trim() || 'unknown error'}`);
  }
  try {
    const wrapper = JSON.parse(res.stdout);
    if (wrapper && typeof wrapper.result === 'string') return wrapper.result;
  } catch { /* not wrapper JSON — fall through */ }
  return res.stdout;
}

// ---------------------------------------------------------------------------
// review gate
// ---------------------------------------------------------------------------

export function renderPlan(plan) {
  return plan.commits.map((c, i) => {
    const msg = formatCommitMessage(c).split('\n').map((l) => '    ' + l).join('\n');
    return `Commit ${i + 1}:\n${msg}\n    files: ${c.files.join(', ')}`;
  }).join('\n\n');
}

export async function reviewGate(plan, { input, output, autoYes } = {}) {
  const out = output ?? process.stdout;
  if (autoYes) return plan;
  let commits = plan.commits.slice();
  for (;;) {
    out.write('\n' + renderPlan({ commits }) + '\n');
    out.write('\n[a]pprove all / [e]dit <n> / [s]kip <n> / [q]uit: ');
    const answer = ((await input()) || 'q').trim();
    const [cmd, nStr] = answer.split(/\s+/);
    const n = Number(nStr) - 1;
    if (cmd === 'a') return { ...plan, commits };
    if (cmd === 'q') return null;
    if (cmd === 's' && commits[n]) { commits.splice(n, 1); if (!commits.length) return null; continue; }
    if (cmd === 'e' && commits[n]) {
      out.write(`new subject for commit ${n + 1}: `);
      const subject = ((await input()) || '').trim();
      if (subject) commits[n] = { ...commits[n], subject };
      continue;
    }
    out.write('unrecognized choice\n');
  }
}

// ---------------------------------------------------------------------------
// interactive review (arrow navigation, per-commit accept)
// ---------------------------------------------------------------------------

// decodeKeys(str) -> normalized key tokens. Pure, so it is unit-testable without
// a terminal. Handles CSI arrow sequences, enter, ctrl-c, and plain characters.
export function decodeKeys(s) {
  const keys = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      const c = s[i + 2];
      if (c === 'A') keys.push('up');
      else if (c === 'B') keys.push('down');
      else if (c === 'C') keys.push('right');
      else if (c === 'D') keys.push('left');
      i += 2;
      continue;
    }
    const ch = s[i];
    if (ch === '\r' || ch === '\n') keys.push('enter');
    else if (ch === '\x03') keys.push('ctrl-c');
    else keys.push(ch);
  }
  return keys;
}

const LEGEND = '↑/↓ move · enter accept · a accept all · s skip · e edit · q quit';

// renderReview(state, {color, width, height}) -> the full panel text (no cursor
// moves). state is { commits, cursor, committed }. The focused commit gets a
// marker + inverse video. Lines are truncated to `width` so they never wrap (a
// wrapped line would desync any cursor-based redraw), and the commit list is
// windowed to `height` so the panel always fits the viewport with the focused
// commit visible. width/height omitted -> no truncation/windowing (tests).
export function renderReview({ commits, cursor, committed }, { color = true, width, height } = {}) {
  const inv = color ? (s) => `\x1b[7m${s}\x1b[0m` : (s) => s;
  const dim = color ? (s) => `\x1b[2m${s}\x1b[0m` : (s) => s;
  const accent = color ? (s) => `\x1b[36m${s}\x1b[0m` : (s) => s;
  // Clip raw (un-styled) text to the available columns, then style it.
  const clip = (s, indent = 0) => {
    const w = width ? width - indent : 0;
    return w && s.length > w ? s.slice(0, Math.max(0, w - 1)) + '…' : s;
  };

  const head = [];
  if (committed.length) {
    head.push(dim(clip(`✓ committed ${committed.length}: ${committed.map((c) => c.subject).join(', ')}`)));
  }
  const footer = ['', dim(clip(LEGEND))];

  const blocks = commits.map((c, i) => {
    const focused = i === cursor;
    const h = clip(formatCommitMessage(c).split('\n')[0], 4);
    const f = clip('files: ' + c.files.join(', '), 5);
    const headRow = (focused ? accent('❯ ') : '  ') + (focused ? inv(` ${h} `) : ` ${h} `);
    return [headRow, '     ' + dim(f)];
  });

  // Window the list to fit `height`, keeping the focused commit on screen.
  let shown = blocks, above = 0, below = 0;
  if (height) {
    const avail = Math.max(2, height - head.length - footer.length);
    const maxBlocks = Math.max(1, Math.floor(avail / 2) - 1); // -1 leaves room for ↑/↓ hints
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
  return lines.join('\n');
}

// interactiveReview(plan, {nextKey, readLine, output, runGit, color}) drives the
// arrow-key gate. nextKey()/readLine() are injectable so the loop is testable
// without raw-mode stdin. Commits happen incrementally via executeOne.
export async function interactiveReview(plan, {
  nextKey, readLine, output, runGit: git = runGit, color = true, width, height,
} = {}) {
  const out = output ?? process.stdout;
  let commits = plan.commits.slice();
  let cursor = 0;
  const committed = [];

  // Redraw by homing the cursor and clearing to end of screen, then reprinting.
  // Robust against shrinking content and (with width-clipping in renderReview)
  // against line wrapping. Pairs with the alt-screen buffer the driver sets up.
  const draw = () => {
    const text = renderReview({ commits, cursor, committed }, { color, width, height });
    out.write('\x1b[H\x1b[J' + text + '\n');
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
      if (key === 'up' || key === 'k') cursor = (cursor - 1 + n) % n;
      else if (key === 'down' || key === 'j') cursor = (cursor + 1) % n;
      else if (key === 'q' || key === 'ctrl-c') break;
      else if (key === 's') {
        commits.splice(cursor, 1);
        if (cursor >= commits.length) cursor = Math.max(0, commits.length - 1);
      } else if (key === 'e') {
        const subject = ((await readLine('  new subject: ')) || '').trim();
        if (subject) commits[cursor] = { ...commits[cursor], subject };
      } else if (key === 'enter') {
        commitAt(cursor);
      } else if (key === 'a') {
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
  input.setEncoding('utf8');
  output.write('\x1b[?1049h\x1b[?25l'); // enter alt screen, hide cursor

  const queue = [];
  const waiters = [];
  const onData = (chunk) => {
    for (const key of decodeKeys(chunk)) {
      if (waiters.length) waiters.shift()(key);
      else queue.push(key);
    }
  };
  input.on('data', onData);

  const nextKey = () => new Promise((res) => {
    if (queue.length) res(queue.shift());
    else waiters.push(res);
  });

  const readLine = (promptText) => new Promise((res) => {
    input.removeListener('data', onData);
    if (input.setRawMode) input.setRawMode(false);
    output.write('\x1b[H\x1b[J\x1b[?25h'); // clear panel, show cursor for typing
    const rl = createInterface({ input, output });
    rl.question(promptText, (ans) => {
      rl.close();
      output.write('\x1b[?25l'); // hide cursor again
      if (input.setRawMode) input.setRawMode(true);
      input.on('data', onData);
      res(ans);
    });
  });

  const close = () => {
    input.removeListener('data', onData);
    output.write('\x1b[?25h\x1b[?1049l'); // show cursor, leave alt screen
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
  const reset = git(['reset', '-q']);
  if (reset.status !== 0) throw new Error(`git reset failed: ${reset.stderr}`);
  const add = git(['add', '--', ...commit.files]);
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`);
  const msg = formatCommitMessage(commit);
  const [subject, ...bodyParts] = msg.split('\n\n');
  const args = ['commit', '-m', subject];
  if (bodyParts.length) args.push('-m', bodyParts.join('\n\n'));
  const commit_ = git(args);
  if (commit_.status !== 0) throw new Error(`git commit failed: ${commit_.stderr}`);
  return { subject: commit.subject, files: commit.files };
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
  return plan.commits.map((c) =>
    `git reset -q && git add -- ${c.files.join(' ')} && git commit -m ${JSON.stringify(c.subject)}`
  ).join('\n');
}

export async function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const out = deps.output ?? process.stdout;
  const err = deps.error ?? process.stderr;
  if (args.help) { out.write(HELP + '\n'); return 0; }

  const doCollect = deps.collect ?? collect;
  const doClaude = deps.callClaude ?? ((prompt) => callClaude(prompt));
  const git = deps.runGit ?? runGit;
  const statusStream = deps.statusStream ?? process.stderr;

  try {
    const { diff, files, log } = doCollect(deps.runGit ? { runGit: git } : undefined);
    if (files.length === 0) { out.write('nothing to commit (tracked changes only)\n'); return 0; }

    const prompt = buildPrompt({ diff, files, log });
    const raw = await withStatus('planning commits', () => doClaude(prompt), { stream: statusStream });
    const plan = parsePlan(raw, files.map((f) => f.path));

    out.write(renderPlan(plan) + '\n');
    if (args.dryRun) {
      out.write('\n--- git commands (dry run) ---\n' + dryRunCommands(plan) + '\n');
      return 0;
    }

    let committed;
    if (args.yes) {
      committed = execute(plan, { runGit: git }).committed;
    } else if (deps.nextKey || (process.stdin.isTTY && deps.input === undefined)) {
      // Interactive arrow-key gate (real TTY, or injected keys for tests).
      const driver = deps.nextKey
        ? { nextKey: deps.nextKey, readLine: deps.readLine ?? (async () => ''), close: () => {} }
        : makeRawKeyDriver(process.stdin, process.stdout);
      const dims = deps.nextKey ? {} : { width: process.stdout.columns || 80, height: process.stdout.rows || 24 };
      try {
        committed = (await interactiveReview(plan, {
          nextKey: driver.nextKey, readLine: driver.readLine,
          output: out, runGit: git, color: !process.env.NO_COLOR, ...dims,
        })).committed;
      } finally {
        driver.close();
      }
    } else {
      // Line-based fallback for piped / non-TTY input.
      let input = deps.input, rl;
      if (!input) {
        rl = createInterface({ input: process.stdin, output: process.stdout });
        input = () => new Promise((res) => rl.question('', res));
      }
      const approved = await reviewGate(plan, { input, output: out });
      if (rl) rl.close();
      if (!approved) { out.write('aborted — nothing committed\n'); return 1; }
      committed = execute(approved, { runGit: git }).committed;
    }

    if (!committed.length) { out.write('\nnothing committed\n'); return 1; }
    out.write(`\nCreated ${committed.length} commit(s):\n` +
      committed.map((c) => `  • ${c.subject}`).join('\n') + '\n');
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
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
