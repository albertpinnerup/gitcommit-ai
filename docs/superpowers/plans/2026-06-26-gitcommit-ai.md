# gitcommit-ai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-file Node.js CLI (`commit`) that groups tracked git changes into logical Conventional-Commits-style commits using the `claude` CLI as a planner, with a review gate before any commit is made.

**Architecture:** One executable ESM file `gitcommit-ai.mjs` that exports small pure + I/O functions and runs a `main()` behind an `import.meta`/argv guard. Pipeline: `collect → buildPrompt → callClaude → parsePlan → reviewGate → execute`. Claude only ever returns a JSON plan; all git mutation happens locally after user approval. Tests use Node's built-in `node:test`.

**Tech Stack:** Node.js (>= 18, for `node:test` + ESM), standard library only (`node:child_process`, `node:readline`, `node:process`). No npm dependencies. Shells out to the `claude` CLI.

## Global Constraints

- Node standard library only — **no npm dependencies** ever added to `package.json`.
- Single shippable executable file: `gitcommit-ai.mjs` (`#!/usr/bin/env node`, ESM `.mjs`).
- Command name installed as `commit` (NOT `gca` — clashes with oh-my-zsh `gca` alias).
- Commit messages follow Conventional Commits: `type(scope): subject`, optional body after a blank line. Valid types: `feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert`.
- Tracked changes only — untracked (`??`) files are excluded everywhere.
- Claude never runs git. It receives context and returns a JSON plan only.
- Test runner: `node --test`. Test files live in `test/*.test.mjs`.

## File Structure

- `gitcommit-ai.mjs` — the entire tool: exported functions + `main()` behind an argv guard.
- `package.json` — `{ "type": "module", "bin": { "commit": "./gitcommit-ai.mjs" }, "scripts": { "test": "node --test" } }`, no deps.
- `test/parse-plan.test.mjs` — `extractJson` + `validatePlan` unit tests.
- `test/build-prompt.test.mjs` — `buildPrompt` unit tests.
- `test/format.test.mjs` — `formatCommitMessage` + `getChangedFiles` (porcelain parse) unit tests.
- `test/collect.test.mjs` — `collect`/`assertRepoState` against a temp git repo.
- `test/execute.test.mjs` — `execute` against a temp git repo.
- `test/cli.test.mjs` — end-to-end `main()` with a mocked claude runner (`--dry-run`, `--yes`).
- `README.md` — usage + install instructions.

All exported function signatures (the canonical interface every task shares):

```
parseArgs(argv: string[]) -> { dryRun: boolean, yes: boolean, help: boolean }
runGit(args: string[], opts?) -> { status: number, stdout: string, stderr: string }
assertRepoState(opts?: {runGit}) -> void            // throws Error on bad state
getChangedFiles(porcelain: string) -> Array<{ status: string, path: string }>
collect(opts?: {runGit}) -> { diff: string, files: Array<{status,path}>, log: string }
buildPrompt({diff, files, log}) -> string
extractJson(text: string) -> object                 // throws on no JSON
validatePlan(plan: object, changedPaths: string[]) -> object   // throws on invalid; returns plan
parsePlan(rawText: string, changedPaths: string[]) -> object   // = validatePlan(extractJson(text), ...)
callClaude(prompt: string, opts?: {runner}) -> string
formatCommitMessage(commit: {type,scope?,subject,body?}) -> string
renderPlan(plan) -> string
reviewGate(plan, opts?: {input, output, autoYes}) -> object|null   // returns approved plan or null
execute(plan, opts?: {runGit}) -> { committed: Array<{subject, files}> }
main(argv, deps?) -> Promise<number>                // exit code
```

A commit object in a plan: `{ files: string[], type: string, scope?: string, subject: string, body?: string }`.

---

### Task 1: Project scaffold + arg parsing + help

**Files:**
- Create: `package.json`
- Create: `gitcommit-ai.mjs`
- Test: `test/cli.test.mjs`

**Interfaces:**
- Produces: `parseArgs(argv)`, `main(argv, deps)`; file is executable with shebang.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "gitcommit-ai",
  "version": "0.1.0",
  "type": "module",
  "bin": { "commit": "./gitcommit-ai.mjs" },
  "scripts": { "test": "node --test" }
}
```

- [ ] **Step 2: Write the failing test** (`test/cli.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../gitcommit-ai.mjs';

test('parseArgs reads flags', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, yes: false, help: false });
  assert.deepEqual(parseArgs(['--dry-run']), { dryRun: true, yes: false, help: false });
  assert.deepEqual(parseArgs(['--yes']), { dryRun: false, yes: true, help: false });
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/cli.test.mjs`
Expected: FAIL — cannot import `parseArgs` (module/exports missing).

- [ ] **Step 4: Write minimal implementation** (`gitcommit-ai.mjs`)

```js
#!/usr/bin/env node

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

export async function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const out = deps.output ?? process.stdout;
  if (args.help) { out.write(HELP + '\n'); return 0; }
  out.write('not yet implemented\n');
  return 0;
}

// Run main() only when invoked as a script, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/cli.test.mjs`
Expected: PASS.

- [ ] **Step 6: Make executable + smoke-test help**

Run: `chmod +x gitcommit-ai.mjs && ./gitcommit-ai.mjs --help`
Expected: prints the usage text.

- [ ] **Step 7: Commit**

```bash
git add package.json gitcommit-ai.mjs test/cli.test.mjs
git commit -m "feat: scaffold CLI with arg parsing and help"
```

---

### Task 2: `extractJson` + `validatePlan` (plan parsing)

**Files:**
- Modify: `gitcommit-ai.mjs`
- Test: `test/parse-plan.test.mjs`

**Interfaces:**
- Produces: `extractJson(text)`, `validatePlan(plan, changedPaths)`, `parsePlan(text, changedPaths)`.
- The file-set invariant: the union of all commits' `files` must equal `changedPaths` exactly.

- [ ] **Step 1: Write the failing test** (`test/parse-plan.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, validatePlan, parsePlan } from '../gitcommit-ai.mjs';

const VALID_TYPES = 'feat fix docs chore refactor';

test('extractJson strips code fences and surrounding prose', () => {
  const text = 'Sure!\n```json\n{"commits":[]}\n```\nDone.';
  assert.deepEqual(extractJson(text), { commits: [] });
});

test('extractJson handles bare JSON', () => {
  assert.deepEqual(extractJson('{"commits":[]}'), { commits: [] });
});

test('extractJson throws when no JSON object present', () => {
  assert.throws(() => extractJson('no json here'), /no JSON/i);
});

test('validatePlan accepts a plan whose files exactly cover the change set', () => {
  const plan = { commits: [
    { files: ['a.js'], type: 'feat', subject: 'add a' },
    { files: ['b.js'], type: 'fix', subject: 'fix b' },
  ]};
  assert.equal(validatePlan(plan, ['a.js', 'b.js']), plan);
});

test('validatePlan rejects a missing file', () => {
  const plan = { commits: [{ files: ['a.js'], type: 'feat', subject: 'a' }] };
  assert.throws(() => validatePlan(plan, ['a.js', 'b.js']), /b\.js/);
});

test('validatePlan rejects an unknown file', () => {
  const plan = { commits: [{ files: ['a.js', 'z.js'], type: 'feat', subject: 'a' }] };
  assert.throws(() => validatePlan(plan, ['a.js']), /z\.js/);
});

test('validatePlan rejects a file in two commits', () => {
  const plan = { commits: [
    { files: ['a.js'], type: 'feat', subject: 'a' },
    { files: ['a.js'], type: 'fix', subject: 'a again' },
  ]};
  assert.throws(() => validatePlan(plan, ['a.js']), /more than one/i);
});

test('validatePlan rejects an invalid type', () => {
  const plan = { commits: [{ files: ['a.js'], type: 'banana', subject: 'a' }] };
  assert.throws(() => validatePlan(plan, ['a.js']), /type/i);
});

test('validatePlan rejects an empty subject', () => {
  const plan = { commits: [{ files: ['a.js'], type: 'feat', subject: '' }] };
  assert.throws(() => validatePlan(plan, ['a.js']), /subject/i);
});

test('parsePlan composes extract + validate', () => {
  const text = '```json\n{"commits":[{"files":["a.js"],"type":"feat","subject":"a"}]}\n```';
  const plan = parsePlan(text, ['a.js']);
  assert.equal(plan.commits.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/parse-plan.test.mjs`
Expected: FAIL — `extractJson`/`validatePlan`/`parsePlan` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `gitcommit-ai.mjs`)

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/parse-plan.test.mjs`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add gitcommit-ai.mjs test/parse-plan.test.mjs
git commit -m "feat: add plan extraction and validation"
```

---

### Task 3: `getChangedFiles` + `formatCommitMessage`

**Files:**
- Modify: `gitcommit-ai.mjs`
- Test: `test/format.test.mjs`

**Interfaces:**
- Produces: `getChangedFiles(porcelain)`, `formatCommitMessage(commit)`.
- `getChangedFiles` parses `git status --porcelain` output: excludes `??` untracked; for renames (`R`) emits BOTH old and new paths as separate entries (so the change set and `git add` cover the deletion and the addition).

- [ ] **Step 1: Write the failing test** (`test/format.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getChangedFiles, formatCommitMessage } from '../gitcommit-ai.mjs';

test('getChangedFiles parses modified and deleted, drops untracked', () => {
  const porcelain = ' M src/a.js\n D src/b.js\n?? new.txt\n';
  assert.deepEqual(getChangedFiles(porcelain), [
    { status: 'M', path: 'src/a.js' },
    { status: 'D', path: 'src/b.js' },
  ]);
});

test('getChangedFiles expands a rename into old and new paths', () => {
  const porcelain = 'R  old.js -> new.js\n';
  assert.deepEqual(getChangedFiles(porcelain), [
    { status: 'D', path: 'old.js' },
    { status: 'A', path: 'new.js' },
  ]);
});

test('getChangedFiles ignores blank lines', () => {
  assert.deepEqual(getChangedFiles('\n M a\n\n'), [{ status: 'M', path: 'a' }]);
});

test('formatCommitMessage with scope and body', () => {
  const msg = formatCommitMessage({ type: 'feat', scope: 'auth', subject: 'add login', body: 'why' });
  assert.equal(msg, 'feat(auth): add login\n\nwhy');
});

test('formatCommitMessage without scope or body', () => {
  assert.equal(formatCommitMessage({ type: 'fix', subject: 'bug' }), 'fix: bug');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/format.test.mjs`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Write minimal implementation** (add to `gitcommit-ai.mjs`)

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/format.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gitcommit-ai.mjs test/format.test.mjs
git commit -m "feat: parse porcelain status and format commit messages"
```

---

### Task 4: `buildPrompt`

**Files:**
- Modify: `gitcommit-ai.mjs`
- Test: `test/build-prompt.test.mjs`

**Interfaces:**
- Produces: `buildPrompt({diff, files, log})` -> string.

- [ ] **Step 1: Write the failing test** (`test/build-prompt.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../gitcommit-ai.mjs';

test('buildPrompt includes diff, file paths, log, and JSON instructions', () => {
  const prompt = buildPrompt({
    diff: 'DIFF_CONTENT',
    files: [{ status: 'M', path: 'src/a.js' }],
    log: 'abc123 feat: earlier',
  });
  assert.match(prompt, /DIFF_CONTENT/);
  assert.match(prompt, /src\/a\.js/);
  assert.match(prompt, /abc123 feat: earlier/);
  assert.match(prompt, /Conventional Commits/i);
  assert.match(prompt, /"commits"/);          // shows the required JSON shape
  assert.match(prompt, /exactly one commit/i); // the one-file-one-commit rule
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-prompt.test.mjs`
Expected: FAIL — `buildPrompt` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `gitcommit-ai.mjs`)

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build-prompt.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gitcommit-ai.mjs test/build-prompt.test.mjs
git commit -m "feat: build Claude planner prompt"
```

---

### Task 5: git helpers + `collect` + `assertRepoState`

**Files:**
- Modify: `gitcommit-ai.mjs`
- Test: `test/collect.test.mjs`

**Interfaces:**
- Consumes: `getChangedFiles`.
- Produces: `runGit(args, opts)`, `assertRepoState(opts)`, `collect(opts)`.
- `runGit` wraps `spawnSync('git', args, {cwd})` returning `{status, stdout, stderr}`. `opts.runGit` is injectable in `collect`/`assertRepoState` for testing; default uses real `runGit` with `process.cwd()`.

- [ ] **Step 1: Write the failing test** (`test/collect.test.mjs`)

This test builds a real temp git repo so `collect` runs against actual git.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collect, assertRepoState } from '../gitcommit-ai.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gca-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir });
  g('init', '-q');
  g('config', 'user.email', 't@t.t');
  g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return { dir, g };
}

test('collect returns diff, tracked files, and log; ignores untracked', () => {
  const { dir, g } = makeRepo();
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');     // modify tracked
  writeFileSync(join(dir, 'untracked.txt'), 'x\n');    // untracked -> excluded
  const result = collect({ runGit: (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }});
  assert.deepEqual(result.files, [{ status: 'M', path: 'a.txt' }]);
  assert.match(result.diff, /\+two/);
  assert.match(result.log, /init/);
  rmSync(dir, { recursive: true, force: true });
});

test('assertRepoState throws outside a repo', () => {
  assert.throws(() => assertRepoState({ runGit: () => ({ status: 128, stdout: '', stderr: 'not a git repo' }) }), /git repo/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/collect.test.mjs`
Expected: FAIL — `collect`/`assertRepoState` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `gitcommit-ai.mjs`)

```js
import { spawnSync } from 'node:child_process';

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
```

Note: move the `import { spawnSync }` line to the top of the file with any other imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/collect.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gitcommit-ai.mjs test/collect.test.mjs
git commit -m "feat: collect tracked changes and guard repo state"
```

---

### Task 6: `callClaude`

**Files:**
- Modify: `gitcommit-ai.mjs`
- Test: `test/cli.test.mjs` (add cases) or new `test/call-claude.test.mjs`

**Interfaces:**
- Produces: `callClaude(prompt, {runner})` -> string (the model's text).
- `runner(prompt)` is an injectable function returning `{status, stdout, stderr}` (defaults to a real `claude -p <prompt> --output-format json` spawn). `callClaude` reads `stdout`, JSON-parses the wrapper, and returns its `.result` string; if the output is not the wrapper JSON, it returns `stdout` as-is.

- [ ] **Step 1: Write the failing test** (`test/call-claude.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude } from '../gitcommit-ai.mjs';

test('callClaude returns .result from the wrapper JSON', () => {
  const runner = () => ({ status: 0, stdout: JSON.stringify({ result: 'MODEL_TEXT' }), stderr: '' });
  assert.equal(callClaude('p', { runner }), 'MODEL_TEXT');
});

test('callClaude returns raw stdout when not wrapper JSON', () => {
  const runner = () => ({ status: 0, stdout: '{"commits":[]}', stderr: '' });
  assert.equal(callClaude('p', { runner }), '{"commits":[]}');
});

test('callClaude throws on non-zero exit', () => {
  const runner = () => ({ status: 1, stdout: '', stderr: 'boom' });
  assert.throws(() => callClaude('p', { runner }), /claude/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/call-claude.test.mjs`
Expected: FAIL — `callClaude` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `gitcommit-ai.mjs`)

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/call-claude.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gitcommit-ai.mjs test/call-claude.test.mjs
git commit -m "feat: invoke claude CLI and extract model text"
```

---

### Task 7: `renderPlan` + `reviewGate`

**Files:**
- Modify: `gitcommit-ai.mjs`
- Test: `test/review.test.mjs`

**Interfaces:**
- Consumes: `formatCommitMessage`.
- Produces: `renderPlan(plan)` -> string, `reviewGate(plan, {input, output, autoYes})` -> plan|null.
- `reviewGate` reads single-line answers from `input` (an async line source) and writes prompts to `output`. With `autoYes: true` it returns the plan unchanged without reading input. `a` -> return plan; `q` -> return null; `s <n>` -> drop commit n (1-based) and re-prompt; `e <n>` -> read replacement subject line for commit n and re-prompt. For testability, `input` is an async iterator/function yielding lines; the real `main` supplies a `node:readline` adapter.

- [ ] **Step 1: Write the failing test** (`test/review.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlan, reviewGate } from '../gitcommit-ai.mjs';

function lineSource(lines) {
  let i = 0;
  return async () => (i < lines.length ? lines[i++] : 'q');
}
const sink = () => { const buf = []; return { write: (s) => buf.push(s), text: () => buf.join('') }; };

const PLAN = { commits: [
  { files: ['a.js'], type: 'feat', subject: 'add a' },
  { files: ['b.js'], type: 'fix', subject: 'fix b' },
]};

test('renderPlan shows each message and its files', () => {
  const text = renderPlan(PLAN);
  assert.match(text, /feat: add a/);
  assert.match(text, /a\.js/);
  assert.match(text, /fix: fix b/);
});

test('reviewGate approve-all returns the plan', async () => {
  const out = sink();
  const result = await reviewGate(PLAN, { input: lineSource(['a']), output: out });
  assert.deepEqual(result, PLAN);
});

test('reviewGate quit returns null', async () => {
  const result = await reviewGate(PLAN, { input: lineSource(['q']), output: sink() });
  assert.equal(result, null);
});

test('reviewGate skip drops a commit then approves', async () => {
  const result = await reviewGate(PLAN, { input: lineSource(['s 2', 'a']), output: sink() });
  assert.equal(result.commits.length, 1);
  assert.equal(result.commits[0].subject, 'add a');
});

test('reviewGate edit replaces a subject', async () => {
  const result = await reviewGate(PLAN, { input: lineSource(['e 1', 'renamed subject', 'a']), output: sink() });
  assert.equal(result.commits[0].subject, 'renamed subject');
});

test('reviewGate autoYes returns plan without input', async () => {
  const result = await reviewGate(PLAN, { autoYes: true, output: sink() });
  assert.deepEqual(result, PLAN);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/review.test.mjs`
Expected: FAIL — `renderPlan`/`reviewGate` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `gitcommit-ai.mjs`)

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/review.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gitcommit-ai.mjs test/review.test.mjs
git commit -m "feat: render plan and interactive review gate"
```

---

### Task 8: `execute`

**Files:**
- Modify: `gitcommit-ai.mjs`
- Test: `test/execute.test.mjs`

**Interfaces:**
- Consumes: `formatCommitMessage`, `runGit`.
- Produces: `execute(plan, {runGit})` -> `{ committed: [{subject, files}] }`.
- For each commit in order: `git reset -q` → `git add -- <files>` → `git commit -m <subject> [-m <body>]`. Stops and throws on the first git non-zero status.

- [ ] **Step 1: Write the failing test** (`test/execute.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execute } from '../gitcommit-ai.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gca-exec-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t.t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'a\n'); writeFileSync(join(dir, 'b.txt'), 'b\n');
  g('add', '-A'); g('commit', '-q', '-m', 'init');
  return { dir, g };
}

test('execute creates one commit per plan entry with the right files', () => {
  const { dir, g } = makeRepo();
  writeFileSync(join(dir, 'a.txt'), 'a2\n');
  writeFileSync(join(dir, 'b.txt'), 'b2\n');
  const runGit = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const plan = { commits: [
    { files: ['a.txt'], type: 'feat', subject: 'change a' },
    { files: ['b.txt'], type: 'fix', subject: 'change b' },
  ]};
  const result = execute(plan, { runGit });
  assert.equal(result.committed.length, 2);
  const log = g('log', '--oneline').stdout;
  assert.match(log, /change a/);
  assert.match(log, /change b/);
  // each commit touched exactly its file
  const show = g('show', '--name-only', '--format=%s', 'HEAD').stdout;
  assert.match(show, /change b/);
  assert.match(show, /b\.txt/);
  assert.doesNotMatch(show, /a\.txt/);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/execute.test.mjs`
Expected: FAIL — `execute` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `gitcommit-ai.mjs`)

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/execute.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gitcommit-ai.mjs test/execute.test.mjs
git commit -m "feat: execute approved plan as sequential commits"
```

---

### Task 9: wire `main()` end-to-end

**Files:**
- Modify: `gitcommit-ai.mjs`
- Test: `test/cli.test.mjs` (extend)

**Interfaces:**
- Consumes: all stages above.
- Produces: final `main(argv, deps)` where `deps` may inject `{ collect, callClaude, input, output, runGit }` for testing. Default deps use the real implementations and a `node:readline` line source.
- Flow: parse args → `collect` → if no files, print "nothing to commit" return 0 → `buildPrompt` → `callClaude` → `parsePlan` → if `--dry-run`, print plan + the git commands and return 0 → `reviewGate` (autoYes when `--yes`) → if null, print "aborted" return 1 → `execute` → print summary → return 0. Wrap the pipeline in try/catch: on error, print the message to stderr and return 1 (repo untouched for pre-execute failures).

- [ ] **Step 1: Write the failing test** (extend `test/cli.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../gitcommit-ai.mjs';

const sink = () => { const b = []; return { write: (s) => b.push(s), text: () => b.join('') }; };
const FAKE_COLLECT = () => ({ diff: 'd', files: [{ status: 'M', path: 'a.js' }], log: 'l' });
const FAKE_CLAUDE = () => JSON.stringify({ commits: [{ files: ['a.js'], type: 'feat', subject: 'add a' }] });

test('main --dry-run prints plan and does not execute', async () => {
  const out = sink();
  let executed = false;
  const code = await main(['--dry-run'], {
    collect: FAKE_COLLECT, callClaude: FAKE_CLAUDE, output: out,
    runGit: () => { executed = true; return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(code, 0);
  assert.match(out.text(), /feat: add a/);
  assert.equal(executed, false);
});

test('main with no changes prints nothing to commit', async () => {
  const out = sink();
  const code = await main([], { collect: () => ({ diff: '', files: [], log: '' }), output: out });
  assert.equal(code, 0);
  assert.match(out.text(), /nothing to commit/i);
});

test('main --yes runs execute via injected runGit', async () => {
  const out = sink();
  const calls = [];
  const runGit = (args) => { calls.push(args[0]); return { status: 0, stdout: '', stderr: '' }; };
  const code = await main(['--yes'], { collect: FAKE_COLLECT, callClaude: FAKE_CLAUDE, output: out, runGit });
  assert.equal(code, 0);
  assert.ok(calls.includes('commit'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.mjs`
Expected: FAIL — `main` still prints "not yet implemented".

- [ ] **Step 3: Replace the `main` body** (in `gitcommit-ai.mjs`)

```js
import { createInterface } from 'node:readline';

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
```

Note: remove the old "not yet implemented" `main`. Keep the single argv-guard at the bottom of the file.

- [ ] **Step 4: Run the full suite**

Run: `node --test`
Expected: PASS — all test files green.

- [ ] **Step 5: Commit**

```bash
git add gitcommit-ai.mjs test/cli.test.mjs
git commit -m "feat: wire end-to-end commit pipeline"
```

---

### Task 10: README + install

**Files:**
- Create: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Write `README.md`**

````markdown
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
````

- [ ] **Step 2: Verify the suite still passes**

Run: `node --test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with install and usage"
```

---

## Self-Review notes

- **Spec coverage:** collect (Task 5), buildPrompt (Task 4), callClaude (Task 6), parsePlan/validate (Task 2), reviewGate (Task 7), execute (Task 8), CLI flags `--dry-run`/`--yes`/`--help` (Tasks 1, 9), edge cases — no repo / detached / mid-merge (Task 5), no changes (Task 9), invalid JSON & file-set mismatch (Task 2), renames (Task 3). README/install (Task 10). All spec sections mapped.
- **Type consistency:** signatures match the interface table; `validatePlan`/`parsePlan`, `runGit` injection, and `reviewGate({input,output,autoYes})` are used consistently across tasks.
- **Placeholders:** none — every code step contains complete code.
