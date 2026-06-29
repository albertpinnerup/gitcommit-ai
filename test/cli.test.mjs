import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, main } from '../gitcommit-ai.mjs';

const sink = () => { const b = []; return { write: (s) => b.push(s), text: () => b.join('') }; };
const FAKE_COLLECT = () => ({ diff: 'd', files: [{ status: 'M', path: 'a.js' }], log: 'l' });
const FAKE_CLAUDE = () => JSON.stringify({ commits: [{ files: ['a.js'], type: 'feat', subject: 'add a' }] });

test('parseArgs reads flags', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, yes: false, help: false, body: false, model: null });
  assert.deepEqual(parseArgs(['--dry-run']), { dryRun: true, yes: false, help: false, body: false, model: null });
  assert.deepEqual(parseArgs(['--yes']), { dryRun: false, yes: true, help: false, body: false, model: null });
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--model', 'haiku']).model, 'haiku');
  assert.equal(parseArgs(['--body']).body, true);
  assert.equal(parseArgs([]).model, null);
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

test('main --yes runs execute via injected runGit', async () => {
  const out = sink();
  const calls = [];
  const runGit = (args) => { calls.push(args[0]); return { status: 0, stdout: '', stderr: '' }; };
  const code = await main(['--yes'], { collect: FAKE_COLLECT, callClaude: FAKE_CLAUDE, output: out, runGit });
  assert.equal(code, 0);
  assert.ok(calls.includes('commit'));
});

test('main interactive: injected keys commit per-commit then accept-all', async () => {
  const out = sink();
  const subjects = [];
  const runGit = (args) => { if (args[0] === 'commit') subjects.push(args[2]); return { status: 0, stdout: '', stderr: '' }; };
  const collect = () => ({ diff: 'd', files: [{ status: 'M', path: 'a.js' }, { status: 'M', path: 'b.js' }], log: 'l' });
  const callClaude = () => JSON.stringify({ commits: [
    { files: ['a.js'], type: 'feat', subject: 'add a' },
    { files: ['b.js'], type: 'fix', subject: 'fix b' },
  ]});
  let i = 0;
  const seq = ['enter', 'a'];
  const nextKey = async () => (i < seq.length ? seq[i++] : 'q');
  const code = await main([], { collect, callClaude, output: out, runGit, nextKey });
  assert.equal(code, 0);
  assert.deepEqual(subjects, ['feat: add a', 'fix: fix b']);
  assert.match(out.text(), /Created 2 commit/);
});
