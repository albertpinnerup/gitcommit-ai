import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeKeys, editorReduce, renderReview, interactiveReview, executeOne } from '../gitcommit-ai.mjs';

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

test('decodeKeys maps backspace, escape, home, and end', () => {
  assert.deepEqual(decodeKeys('\x7f'), ['backspace']);
  assert.deepEqual(decodeKeys('\x08'), ['backspace']);
  assert.deepEqual(decodeKeys('\x1b'), ['escape']);
  assert.deepEqual(decodeKeys('\x1b[H'), ['home']);
  assert.deepEqual(decodeKeys('\x1b[F'), ['end']);
  assert.deepEqual(decodeKeys('\x1b[3~'), ['delete']);
});

test('editorReduce inserts, backspaces, and moves the cursor', () => {
  let s = { buf: 'add a', pos: 5 };
  s = editorReduce(s, 'backspace').state;          // 'add '
  assert.deepEqual(s, { buf: 'add ', pos: 4 });
  s = editorReduce(s, 'b').state;                  // 'add b'
  assert.deepEqual(s, { buf: 'add b', pos: 5 });
  s = editorReduce(s, 'home').state;
  assert.equal(s.pos, 0);
  s = editorReduce(s, 'right').state;
  assert.equal(s.pos, 1);
  s = editorReduce(s, 'X').state;                  // insert at pos 1 -> 'aXdd b'
  assert.deepEqual(s, { buf: 'aXdd b', pos: 2 });
});

test('editorReduce: enter accepts, escape and ctrl-c cancel', () => {
  assert.deepEqual(editorReduce({ buf: 'hi', pos: 2 }, 'enter'), { done: true, value: 'hi' });
  assert.equal(editorReduce({ buf: 'hi', pos: 2 }, 'escape').cancelled, true);
  assert.equal(editorReduce({ buf: 'hi', pos: 2 }, 'ctrl-c').cancelled, true);
});

// ---- renderReview ------------------------------------------------------------

test('renderReview numbers commits and marks the focused one', () => {
  const text = renderReview({ commits: PLAN.commits, cursor: 1, committed: [] }, { color: false });
  const lines = text.split('\n');
  // numbered labels are present
  assert.match(text, /Commit 1/);
  assert.match(text, /Commit 2/);
  // focus marker sits on the focused commit's label row (Commit 2), not Commit 1
  const c1 = lines.find((l) => l.includes('Commit 1'));
  const c2 = lines.find((l) => l.includes('Commit 2'));
  assert.ok(!c1.includes('❯'));
  assert.ok(c2.includes('❯'));
  assert.match(text, /enter accept/i);
  assert.match(text, /accept all/i);
  assert.match(text, /quit/i);
});

test('renderReview truncates long lines to width so they never wrap', () => {
  const long = { commits: [{ files: ['x'], type: 'feat', subject: 'x'.repeat(200) }], cursor: 0, committed: [] };
  const text = renderReview(long, { color: false, width: 40 });
  for (const line of text.split('\n')) {
    assert.ok(line.length <= 40, `line exceeds width: ${line.length}`);
  }
  assert.match(text, /…/); // truncation marker present
});

test('renderReview windows a long list to height and keeps the cursor visible', () => {
  const commits = Array.from({ length: 40 }, (_, i) => ({ files: [`f${i}.js`], type: 'feat', subject: `commit ${i}` }));
  const text = renderReview({ commits, cursor: 20, committed: [] }, { color: false, width: 80, height: 12 });
  const lines = text.split('\n');
  assert.ok(lines.length <= 12, `panel taller than height: ${lines.length}`);
  assert.match(text, /feat: commit 20/);  // focused commit is on screen
  assert.match(text, /↑ \d+ more/);        // hidden-above indicator
  assert.match(text, /↓ \d+ more/);        // hidden-below indicator
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

test('interactiveReview: e pre-fills the full header and lets you change the tag', async () => {
  const { runGit, subjects } = fakeGit();
  let seenInitial;
  const readLine = async (_prompt, initial) => { seenInitial = initial; return 'feat(upgrade): add a'; };
  await interactiveReview(PLAN, { nextKey: keys(['e', 'enter', 'q']), readLine, output: sink(), runGit });
  assert.equal(seenInitial, 'feat: add a');                // pre-filled with the whole tag+subject
  assert.deepEqual(subjects, ['feat(upgrade): add a']);    // edited tag is what gets committed
});

test('interactiveReview: cancelling an edit (null) keeps the original message', async () => {
  const { runGit, subjects } = fakeGit();
  const readLine = async () => null;              // user pressed esc
  await interactiveReview(PLAN, { nextKey: keys(['e', 'enter', 'q']), readLine, output: sink(), runGit });
  assert.deepEqual(subjects, ['feat: add a']);    // unchanged
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
  assert.equal(out.subject, 'feat: change a'); // reports the actual committed header
  const show = g('show', '--name-only', '--format=%s', 'HEAD').stdout;
  assert.match(show, /change a/);
  assert.match(show, /a\.txt/);
  assert.doesNotMatch(show, /b\.txt/); // b.txt left uncommitted
  rmSync(dir, { recursive: true, force: true });
});
