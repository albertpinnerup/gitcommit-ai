import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeKeys, renderReview, interactiveReview, executeOne } from '../gitcommit-ai.mjs';

const PLAN = { commits: [
  { files: ['a.js'], type: 'feat', subject: 'add a' },
  { files: ['b.js'], type: 'fix', subject: 'fix b' },
]};

// ---- decodeKeys --------------------------------------------------------------

test('decodeKeys maps arrows, enter, ctrl-c, and plain chars', () => {
  assert.deepEqual(decodeKeys('\x1b[A'), ['up']);
  assert.deepEqual(decodeKeys('\x1b[B'), ['down']);
  assert.deepEqual(decodeKeys('\r'), ['enter']);
  assert.deepEqual(decodeKeys('\n'), ['enter']);
  assert.deepEqual(decodeKeys('\x03'), ['ctrl-c']);
  assert.deepEqual(decodeKeys('a'), ['a']);
  assert.deepEqual(decodeKeys('\x1b[Bq'), ['down', 'q']);
});

// ---- renderReview ------------------------------------------------------------

test('renderReview marks the focused commit and shows the legend', () => {
  const text = renderReview({ commits: PLAN.commits, cursor: 1, committed: [] }, { color: false });
  const lines = text.split('\n');
  const aLine = lines.find((l) => l.includes('feat: add a'));
  const bLine = lines.find((l) => l.includes('fix: fix b'));
  assert.ok(!aLine.includes('❯'));      // unfocused row has no marker
  assert.ok(bLine.includes('❯'));       // focus marker on the cursor row
  assert.match(text, /enter accept/i);
  assert.match(text, /accept all/i);
  assert.match(text, /quit/i);
});

test('renderReview shows committed progress', () => {
  const text = renderReview(
    { commits: [PLAN.commits[1]], cursor: 0, committed: [{ subject: 'add a', files: ['a.js'] }] },
    { color: false },
  );
  assert.match(text, /committed 1/i);
});

// ---- interactiveReview (injected keys + fake git) ----------------------------

function fakeGit() {
  const subjects = [];
  const runGit = (args) => {
    if (args[0] === 'commit') subjects.push(args[2]); // the -m <subject>
    return { status: 0, stdout: '', stderr: '' };
  };
  return { runGit, subjects };
}
function keys(seq) { let i = 0; return async () => (i < seq.length ? seq[i++] : 'q'); }
const sink = () => { const b = []; return { write: (s) => b.push(s), text: () => b.join('') }; };

test('interactiveReview: enter commits only the focused commit', async () => {
  const { runGit, subjects } = fakeGit();
  const res = await interactiveReview(PLAN, { nextKey: keys(['enter', 'q']), output: sink(), runGit });
  assert.deepEqual(subjects, ['feat: add a']);
  assert.equal(res.committed.length, 1);
});

test('interactiveReview: arrow down then enter commits the second', async () => {
  const { runGit, subjects } = fakeGit();
  await interactiveReview(PLAN, { nextKey: keys(['down', 'enter', 'q']), output: sink(), runGit });
  assert.deepEqual(subjects, ['fix: fix b']);
});

test('interactiveReview: a accepts all remaining in order', async () => {
  const { runGit, subjects } = fakeGit();
  const res = await interactiveReview(PLAN, { nextKey: keys(['a']), output: sink(), runGit });
  assert.deepEqual(subjects, ['feat: add a', 'fix: fix b']);
  assert.equal(res.committed.length, 2);
});

test('interactiveReview: s skips a commit without committing it', async () => {
  const { runGit, subjects } = fakeGit();
  await interactiveReview(PLAN, { nextKey: keys(['s', 'enter', 'q']), output: sink(), runGit });
  assert.deepEqual(subjects, ['fix: fix b']); // first dropped, second committed
});

test('interactiveReview: e edits the focused subject before committing', async () => {
  const { runGit, subjects } = fakeGit();
  await interactiveReview(PLAN, {
    nextKey: keys(['e', 'enter', 'q']),
    readLine: async () => 'reworded',
    output: sink(), runGit,
  });
  assert.deepEqual(subjects, ['feat: reworded']);
});

test('interactiveReview: q with nothing committed returns empty', async () => {
  const { runGit, subjects } = fakeGit();
  const res = await interactiveReview(PLAN, { nextKey: keys(['q']), output: sink(), runGit });
  assert.deepEqual(subjects, []);
  assert.equal(res.committed.length, 0);
});

// ---- executeOne against a real repo ------------------------------------------

test('executeOne commits exactly one commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gca-one-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t.t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'a\n'); writeFileSync(join(dir, 'b.txt'), 'b\n');
  g('add', '-A'); g('commit', '-q', '-m', 'init');
  writeFileSync(join(dir, 'a.txt'), 'a2\n'); writeFileSync(join(dir, 'b.txt'), 'b2\n');
  const runGit = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const out = executeOne({ files: ['a.txt'], type: 'feat', subject: 'change a' }, { runGit });
  assert.equal(out.subject, 'change a');
  const show = g('show', '--name-only', '--format=%s', 'HEAD').stdout;
  assert.match(show, /change a/);
  assert.match(show, /a\.txt/);
  assert.doesNotMatch(show, /b\.txt/); // b.txt left uncommitted
  rmSync(dir, { recursive: true, force: true });
});
