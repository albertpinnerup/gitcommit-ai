#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

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
// claude invocation
// ---------------------------------------------------------------------------

export function callClaude(prompt, { runner } = {}) {
  const run = runner ?? ((p) => {
    const r = spawnSync('claude', ['-p', p, '--output-format', 'json'], { encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  });
  const res = run(prompt);
  if (res.status !== 0) {
    throw new Error(`claude CLI failed: ${res.stderr.trim() || 'unknown error'}`);
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
// execution
// ---------------------------------------------------------------------------

export function execute(plan, { runGit: git = runGit } = {}) {
  const committed = [];
  for (const c of plan.commits) {
    const reset = git(['reset', '-q']);
    if (reset.status !== 0) throw new Error(`git reset failed: ${reset.stderr}`);
    const add = git(['add', '--', ...c.files]);
    if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`);
    const msg = formatCommitMessage(c);
    const [subject, ...bodyParts] = msg.split('\n\n');
    const args = ['commit', '-m', subject];
    if (bodyParts.length) args.push('-m', bodyParts.join('\n\n'));
    const commit = git(args);
    if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`);
    committed.push({ subject: c.subject, files: c.files });
  }
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

  try {
    const { diff, files, log } = doCollect(deps.runGit ? { runGit: git } : undefined);
    if (files.length === 0) { out.write('nothing to commit (tracked changes only)\n'); return 0; }

    const prompt = buildPrompt({ diff, files, log });
    const raw = doClaude(prompt);
    const plan = parsePlan(raw, files.map((f) => f.path));

    out.write(renderPlan(plan) + '\n');
    if (args.dryRun) {
      out.write('\n--- git commands (dry run) ---\n' + dryRunCommands(plan) + '\n');
      return 0;
    }

    let input = deps.input;
    let rl;
    if (!input && !args.yes) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
      input = () => new Promise((res) => rl.question('', res));
    }
    const approved = await reviewGate(plan, { input, output: out, autoYes: args.yes });
    if (rl) rl.close();
    if (!approved) { out.write('aborted — nothing committed\n'); return 1; }

    const { committed } = execute(approved, { runGit: git });
    out.write(`\nCreated ${committed.length} commit(s):\n` +
      committed.map((c) => `  • ${c.subject}`).join('\n') + '\n');
    return 0;
  } catch (e) {
    err.write(`error: ${e.message}\n`);
    return 1;
  }
}

// Run main() only when invoked as a script, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
