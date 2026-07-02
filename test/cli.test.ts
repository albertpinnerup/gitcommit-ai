import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.ts';
import { main } from '../src/commands/commit.ts';

const sink = () => { const b = []; return { write: (s) => b.push(s), text: () => b.join('') }; };
const FAKE_COLLECT = () => ({ diff: 'd', files: [{ status: 'M', path: 'a.js' }], log: 'l' });
const FAKE_CLAUDE = () => JSON.stringify({ commits: [{ files: ['a.js'], type: 'feat', subject: 'add a' }] });

test('parseArgs reads flags', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, apply: false, help: false, verbose: false, model: null, demo: false, demoScenario: 'default' });
  assert.deepEqual(parseArgs(['--dry-run']), { dryRun: true, apply: false, help: false, verbose: false, model: null, demo: false, demoScenario: 'default' });
  assert.deepEqual(parseArgs(['--apply']), { dryRun: false, apply: true, help: false, verbose: false, model: null, demo: false, demoScenario: 'default' });
  assert.equal(parseArgs(['-a']).apply, true);
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--model', 'haiku']).model, 'haiku');
  assert.equal(parseArgs(['-v']).verbose, true);
  assert.equal(parseArgs(['--verbose']).verbose, true);
  assert.equal(parseArgs(['--body']).verbose, true); // back-compat alias
  assert.equal(parseArgs([]).model, null);
});

test('parseArgs reads --demo and its optional scenario', () => {
  assert.equal(parseArgs([]).demo, false);
  assert.deepEqual(
    [parseArgs(['--demo']).demo, parseArgs(['--demo']).demoScenario],
    [true, 'default'],
  );
  assert.equal(parseArgs(['--demo', 'many']).demoScenario, 'many');
  assert.equal(parseArgs(['--demo', 'list']).demoScenario, 'list');
  // a following flag is not consumed as the scenario name
  assert.equal(parseArgs(['--demo', '--dry-run']).demoScenario, 'default');
});

test('main --help prints usage', async () => {
  const out = sink();
  const code = await main(['--help'], { output: out });
  assert.equal(code, 0);
  assert.match(out.text(), /Usage: commit/);
});

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

test('main prints a timing readout on a TTY status stream', async () => {
  const out = sink();
  const status = { isTTY: true, lines: [], write(s) { this.lines.push(s); } };
  await main(['--dry-run'], { collect: FAKE_COLLECT, callClaude: FAKE_CLAUDE, output: out, statusStream: status });
  assert.match(status.lines.join(''), /planned 1 commit in \d+\.\d+s/);
});

test('main with no changes prints nothing to commit', async () => {
  const out = sink();
  const code = await main([], { collect: () => ({ diff: '', files: [], log: '' }), output: out });
  assert.equal(code, 0);
  assert.match(out.text(), /nothing to commit/i);
});

test('main --apply runs execute via injected runGit', async () => {
  const out = sink();
  const calls = [];
  const runGit = (args) => { calls.push(args[0]); return { status: 0, stdout: '', stderr: '' }; };
  const code = await main(['--apply'], { collect: FAKE_COLLECT, callClaude: FAKE_CLAUDE, output: out, runGit });
  assert.equal(code, 0);
  assert.ok(calls.includes('commit'));
});

// Removed: 'main interactive: injected keys commit per-commit then accept-all'
// The interactive TUI path is now exercised via test/tui-run.test.ts and
// test/tui-app*.test.ts. The old test injected nextKey into Deps, which no
// longer exists — the interactive path uses runTui() instead.
