import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, main } from '../gitcommit-ai.mjs';

const sink = () => { const b = []; return { write: (s) => b.push(s), text: () => b.join('') }; };
const FAKE_COLLECT = () => ({ diff: 'd', files: [{ status: 'M', path: 'a.js' }], log: 'l' });
const FAKE_CLAUDE = () => JSON.stringify({ commits: [{ files: ['a.js'], type: 'feat', subject: 'add a' }] });

test('parseArgs reads flags', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, yes: false, help: false });
  assert.deepEqual(parseArgs(['--dry-run']), { dryRun: true, yes: false, help: false });
  assert.deepEqual(parseArgs(['--yes']), { dryRun: false, yes: true, help: false });
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
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
